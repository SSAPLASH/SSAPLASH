"""음원 분리 추론 모듈 (설계 2장 separation, 3장 "분리 모듈", 4-1절 1~3번).

원곡 파일 → 드럼 트랙 파일 + 반주 파일 + SeparationOutput. 모델은 벤치마크 어댑터
(`bench/separators`, 기본 BS Roformer SW)를 그대로 import해 씀. 반주 = 원곡 − 드럼 트랙(샘플 단위 뺄셈)이라
세 파일의 샘플 수와 시간축이 같음(BE 요구 audioTimeOrigin = SOURCE_START).

흐름: SeparationModule(config).load() 한 번 → separate_file() 곡마다 → close().
진행 콜백 on_progress(stage, fraction): stage는 LOAD_INPUT·SEPARATE·WRITE, fraction은 단계 시작 0·끝 1.
처리 시간·메모리는 벤치마크 `metrics/resource_usage.py`로 잼.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from ssaplash_ai.bench.metrics.resource_usage import cuda_available, measure_resources
from ssaplash_ai.bench.separators import BaseSeparator, SeparatorConfig, create_separator
from ssaplash_ai.chart.audio_io import duration_ms, read_audio_file, write_audio_file
from ssaplash_ai.chart.config import SeparationConfig
from ssaplash_ai.chart.errors import (
    ChartError,
    ChartModelError,
    model_error_from,
    summarize_exception,
)

STAGES = ("LOAD_INPUT", "SEPARATE", "WRITE")
AUDIO_TIME_ORIGIN = "SOURCE_START"
DRUM_STEM_NAME = "drums"
ACCOMPANIMENT_NAME = "accompaniment"

ProgressCallback = Callable[[str, float], None]


@dataclass
class SeparationOutput:
    """separate_file 결과. BE SeparationResult 대응은 설계 3장 표."""

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


def _mb_or_none(value: float) -> float | None:
    return None if value is None or math.isnan(value) else round(float(value), 1)


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
        """체크포인트 파일명 + 모델 yaml 해시 12자리 (설계 3장 model_version)."""
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
    ) -> SeparationOutput:
        """원곡 파일 → out_dir/drums.<형식>, out_dir/accompaniment.<형식> 저장 → SeparationOutput."""
        self._require_loaded()
        notify = on_progress or _no_progress
        sample_rate = self.config.output.sample_rate
        fmt = self.config.output.format

        notify("LOAD_INPUT", 0.0)
        mixture = read_audio_file(input_path, sample_rate, self.config.max_duration_sec)
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
        accompaniment = mixture - drums
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
            duration_ms=duration_ms(mixture.shape[1], sample_rate),
            sample_rate=sample_rate,
            model_name=self.model_name,
            model_version=self.model_version,
            load_ms=int(round((self.load_sec or 0.0) * 1000)),
            separate_ms=int(round(usage.elapsed_sec * 1000)),
            peak_vram_mb=_mb_or_none(usage.peak_vram_mb),
            peak_ram_mb=_mb_or_none(usage.peak_ram_mb),
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
