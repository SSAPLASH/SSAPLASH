"""음원 분리 추론 모듈. 원곡 파일 → 드럼 트랙 파일 + 반주 파일 + SeparationOutput.

반주 = 원곡 − 드럼 트랙이라 세 파일의 샘플 수와 시간축이 같음.
흐름: SeparationModule(config).load() 한 번 → separate_file() 곡마다 → close().
진행 콜백 on_progress(stage, fraction): stage는 LOAD_INPUT·SEPARATE·WRITE.

duration_ms를 주면 출력 두 파일을 그 길이에 맞춰 끝에서만 자르거나 채움.
저장 전 피크 처리: 드럼 트랙은 피크가 OUTPUT_PEAK_DBFS를 넘으면 파일 전체 볼륨을 낮추고(채보 입력이라 파형은 그대로),
반주는 넘는 순간만 누르는 리미터를 걺. 그래서 드럼 + 반주가 원곡과 같지 않을 수 있음.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.metrics.resource_usage import cuda_available, measure_resources
from ssaplash_ai.bench.separators import BaseSeparator, SeparatorConfig, create_separator
from ssaplash_ai.bench.separators.postprocess import LIMIT_DBFS, limit_peaks
from ssaplash_ai.chart.audio_io import duration_ms as samples_to_ms
from ssaplash_ai.chart.audio_io import fit_length, read_audio_file, samples_for_ms, write_audio_file
from ssaplash_ai.chart.config import SeparationConfig
from ssaplash_ai.chart.errors import (
    ChartError,
    ChartInputError,
    ChartModelError,
    model_error_from,
    summarize_exception,
)

STAGES = ("LOAD_INPUT", "SEPARATE", "WRITE")
AUDIO_TIME_ORIGIN = "SOURCE_START"
DRUM_STEM_NAME = "drums"
ACCOMPANIMENT_NAME = "accompaniment"
# BE가 준 원곡 길이와 실측 길이의 허용 차이(ms). mp3 디코더·ffprobe 버전 차이는 수십 ms
DURATION_TOLERANCE_MS = 1000
# 저장 파일 피크 상한 (dBFS). 스트리밍 음량 권고의 피크 여유 1dB를 따름
OUTPUT_PEAK_DBFS = LIMIT_DBFS

ProgressCallback = Callable[[str, float], None]


@dataclass
class SeparationOutput:
    """separate_file 결과. BE SeparationResult에 대응."""

    drum_stem_path: Path
    accompaniment_path: Path
    duration_ms: int
    sample_rate: int
    model_name: str
    model_version: str
    load_ms: int
    separate_ms: int
    peak_vram_mb: float | None
    peak_ram_mb: float | None
    audio_time_origin: str = AUDIO_TIME_ORIGIN
    # 잘림을 막으려고 드럼 파일 전체에 곱한 이득 (dB). 줄이지 않았으면 0
    drums_gain_db: float = 0.0
    # 반주 리미터가 가장 많이 누른 양 (dB). 누른 곳이 없으면 0
    accompaniment_limit_db: float = 0.0

    def to_dict(self) -> dict:
        """JSON으로 쓸 수 있는 dict. 경로는 문자열."""
        d = asdict(self)
        d["drum_stem_path"] = str(self.drum_stem_path)
        d["accompaniment_path"] = str(self.accompaniment_path)
        return d


def resolve_device(device: str) -> str:
    """cuda를 요청했는데 torch가 없거나 CUDA를 못 쓰면 cpu."""
    if device.startswith("cuda") and not cuda_available(device):
        return "cpu"
    return device


def headroom_gain(*tracks, peak_dbfs: float = OUTPUT_PEAK_DBFS) -> float:
    """트랙들 중 가장 큰 샘플 절댓값이 peak_dbfs를 넘으면 그만큼 줄이는 이득, 아니면 1."""
    peak = max((float(np.max(np.abs(t))) if t.size else 0.0) for t in tracks)
    limit = 10.0 ** (peak_dbfs / 20.0)
    return limit / peak if peak > limit else 1.0


def _mb_or_none(value: float) -> float | None:
    return None if value is None or math.isnan(value) else round(float(value), 1)


def target_samples(duration_ms: int, measured_ms: int, sample_rate: int) -> int:
    """BE가 준 원곡 길이(ms)로 출력 샘플 수를 정함. 실측과 너무 다르면 ChartInputError."""
    if duration_ms <= 0:
        raise ChartInputError(f"원곡 길이가 양수가 아님: {duration_ms} ms")
    if abs(measured_ms - duration_ms) > DURATION_TOLERANCE_MS:
        raise ChartInputError(
            f"원곡 길이가 배정 값과 다름: 실측 {measured_ms} ms, 배정 {duration_ms} ms "
            f"(허용 차이 {DURATION_TOLERANCE_MS} ms)"
        )
    return samples_for_ms(duration_ms, sample_rate)


class SeparationModule:
    """분리 모델을 한 번 올려 여러 곡을 처리하는 모듈."""

    def __init__(self, config: SeparationConfig, device: str | None = None) -> None:
        self.config = config
        self.device = resolve_device(device or config.device)
        self.load_sec: float | None = None
        self._separator: BaseSeparator | None = None
        self._model_config: SeparatorConfig | None = None

    @property
    def loaded(self) -> bool:
        return self._separator is not None

    @property
    def model_name(self) -> str:
        """모델 yaml의 name (예: bs_roformer_sw)."""
        self._require_loaded()
        return self._model_config.name

    @property
    def model_version(self) -> str:
        """체크포인트 파일명 + 모델 yaml 해시 12자리."""
        self._require_loaded()
        return f"{self._separator.info().checkpoint}@{self._model_config.config_hash}"

    def load(self) -> float:
        """모델 yaml 읽기 → 가중치 다운로드(없으면) → 올리기. 올리는 데 걸린 초를 돌려줌."""
        try:
            model_config = SeparatorConfig.from_yaml(self.config.model_config)
            separator = create_separator(model_config, self.device)
        except (OSError, ValueError) as e:
            raise ChartModelError(f"모델 설정을 읽지 못함: {summarize_exception(e)}") from e
        try:
            self.load_sec = separator.load()
        except Exception as e:
            raise model_error_from(e, "모델 올리기") from e
        self._separator = separator
        self._model_config = model_config
        return self.load_sec

    def separate_file(
        self,
        input_path: str | Path,
        out_dir: str | Path,
        on_progress: ProgressCallback | None = None,
        duration_ms: int | None = None,
    ) -> SeparationOutput:
        """원곡 파일 → out_dir/drums.<형식>, out_dir/accompaniment.<형식> 저장 → SeparationOutput.

        duration_ms를 주면(워커가 BE claim의 원곡 길이를 넘김) 출력 두 파일을 그 길이의 샘플 수에
        맞추고 결과 duration_ms에 그 값을 씀. 없으면 원곡 샘플 수 그대로.
        """
        self._require_loaded()
        notify = on_progress or _no_progress
        sample_rate = self.config.output.sample_rate
        fmt = self.config.output.format

        notify("LOAD_INPUT", 0.0)
        mixture = read_audio_file(input_path, sample_rate, self.config.max_duration_sec)
        measured_ms = samples_to_ms(mixture.shape[1], sample_rate)
        n_target = None
        if duration_ms is not None:
            n_target = target_samples(duration_ms, measured_ms, sample_rate)
        notify("LOAD_INPUT", 1.0)

        notify("SEPARATE", 0.0)
        try:
            with measure_resources(self.device) as usage:
                result = self._separator.separate(mixture, sample_rate)
        except ChartError:
            raise
        except Exception as e:
            raise model_error_from(e, "분리") from e
        drums = result.drums
        accompaniment = result.accomp if result.accomp is not None else mixture - drums
        if n_target is not None:
            drums = fit_length(drums, n_target)
            accompaniment = fit_length(accompaniment, n_target)
        drum_gain = headroom_gain(drums)
        if drum_gain < 1.0:
            drums = drums * drum_gain
        accompaniment, accomp_limit_db = limit_peaks(accompaniment, sample_rate, OUTPUT_PEAK_DBFS)
        notify("SEPARATE", 1.0)

        notify("WRITE", 0.0)
        out_dir = Path(out_dir)
        drum_path = write_audio_file(out_dir / f"{DRUM_STEM_NAME}.{fmt}", drums, sample_rate, fmt)
        accomp_path = write_audio_file(
            out_dir / f"{ACCOMPANIMENT_NAME}.{fmt}", accompaniment, sample_rate, fmt
        )
        notify("WRITE", 1.0)

        return SeparationOutput(
            drum_stem_path=drum_path,
            accompaniment_path=accomp_path,
            duration_ms=duration_ms if duration_ms is not None else measured_ms,
            sample_rate=sample_rate,
            model_name=self.model_name,
            model_version=self.model_version,
            load_ms=int(round((self.load_sec or 0.0) * 1000)),
            separate_ms=int(round(usage.elapsed_sec * 1000)),
            peak_vram_mb=_mb_or_none(usage.peak_vram_mb),
            peak_ram_mb=_mb_or_none(usage.peak_ram_mb),
            drums_gain_db=round(20.0 * math.log10(drum_gain), 2),
            accompaniment_limit_db=accomp_limit_db,
        )

    def close(self) -> None:
        """모델 해제. load 전에 불러도 됨."""
        if self._separator is not None:
            self._separator.close()
            self._separator = None
            self._model_config = None

    def _require_loaded(self) -> None:
        if not self.loaded:
            raise ChartModelError("load()를 먼저 호출")


def _no_progress(stage: str, fraction: float) -> None:
    return None
