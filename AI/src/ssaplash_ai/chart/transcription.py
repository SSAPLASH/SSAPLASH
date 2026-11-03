"""드럼 채보 추론 모듈 (설계 2장 transcription, 3장 "채보 모듈", 4-1절 5~6번).

드럼 트랙 파일 → 채보 JSON 파일 + TranscriptionOutput. 모델은 `configs/chart/transcription.yaml`의
model_config가 가리키는 벤치마크 yaml로 고르고(기본 ADTOF + 드럼 킷 분리), 벤치마크 어댑터
(`bench/transcribers`)를 그대로 import해 씀. 모델·규칙을 바꿀 때는 그 경로만 바꾸고 이 파일은 고치지 않음.

흐름: TranscriptionModule(config).load() 한 번 → transcribe_file() 곡마다 → close().
진행 콜백 on_progress(stage, fraction): stage는 LOAD_INPUT·TRANSCRIBE·JSON, fraction은 단계 시작 0·끝 1.
bpm은 설정 tempo.method의 추정기(서비스는 Beat This!, 설계 U15)로 구하고, 채보 모델과 같이 load()에서 올림.
generatorVersion은 `<모델 yaml name>@<해시 12자리>`. 해시에 모델 yaml, bpm 방법·설정, offsetMs·bpm 계산 규칙 버전이
들어가서 채보 모델·규칙 값·bpm 방법·시각 규칙 중 하나만 바뀌어도 같이 바뀜(설계 U5·U15).
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from ssaplash_ai.bench.datasets.base import SAMPLE_RATE
from ssaplash_ai.bench.metrics.resource_usage import measure_resources
from ssaplash_ai.bench.transcribers import BaseTranscriber, TranscriberConfig, create_transcriber
from ssaplash_ai.chart.audio_io import duration_ms as samples_to_ms
from ssaplash_ai.chart.audio_io import read_audio_file
from ssaplash_ai.chart.chart_json import (
    TIMING_RULES_VERSION,
    build_chart,
    notes_by_pad,
    validate_chart,
)
from ssaplash_ai.chart.config import TranscriptionConfig
from ssaplash_ai.chart.errors import (
    ChartError,
    ChartModelError,
    ChartOutputError,
    model_error_from,
    summarize_exception,
)
from ssaplash_ai.chart.separation import resolve_device
from ssaplash_ai.chart.tempo import TempoEstimator, create_tempo_estimator

STAGES = ("LOAD_INPUT", "TRANSCRIBE", "JSON")
CHART_FILENAME = "chart.json"

ProgressCallback = Callable[[str, float], None]


@dataclass
class TranscriptionOutput:
    """transcribe_file 결과. chart는 chart.json과 같은 내용. BE 대응은 설계 3장 표."""

    chart_json_path: Path
    chart: dict
    n_notes: int
    notes_by_pad: dict[str, int]
    duration_ms: int
    bpm: float
    raw_bpm: float | None
    first_beat_ms: int | None
    first_downbeat_ms: int | None
    bpm_estimated: bool
    bpm_method: str
    model_name: str
    model_version: str
    load_ms: int
    transcribe_ms: int
    peak_vram_mb: float | None
    peak_ram_mb: float | None

    def to_dict(self) -> dict:
        """결과 메타(transcription.json)용 dict. 채보 본문은 chart.json에 있으므로 뺌."""
        d = asdict(self)
        d.pop("chart")
        d["chart_json_path"] = str(self.chart_json_path)
        return d


def _mb_or_none(value: float | None) -> float | None:
    return None if value is None or math.isnan(value) else round(float(value), 1)


class TranscriptionModule:
    """채보 모델을 한 번 올려 여러 곡을 처리하는 모듈."""

    def __init__(self, config: TranscriptionConfig, device: str | None = None) -> None:
        self.config = config
        self.device = resolve_device(device or config.device)
        self.load_sec: float | None = None
        self._transcriber: BaseTranscriber | None = None
        self._model_config: TranscriberConfig | None = None
        self._tempo: TempoEstimator | None = None

    @property
    def loaded(self) -> bool:
        return self._transcriber is not None

    @property
    def model_name(self) -> str:
        """모델 yaml의 name (예: adtof_drumsep)."""
        self._require_loaded()
        return self._model_config.name

    @property
    def model_version(self) -> str:
        """모델 yaml name + 해시 12자리(모델 yaml·bpm 방법·tempo 설정·시각 규칙 버전). 채보 JSON generatorVersion (설계 U5)."""
        self._require_loaded()
        tempo = self.config.tempo
        key = "|".join(
            (
                self._model_config.config_hash,
                self._tempo.version_id,
                f"{tempo.min_bpm:g}-{tempo.max_bpm:g}",
                tempo.time_signature,
                TIMING_RULES_VERSION,
            )
        )
        return f"{self._model_config.name}@{hashlib.sha256(key.encode()).hexdigest()[:12]}"

    def load(self) -> float:
        """모델 yaml 읽기 → 가중치 다운로드(없으면) → 채보 모델·bpm 모델 올리기. 올리는 데 걸린 초를 돌려줌."""
        try:
            model_config = TranscriberConfig.from_yaml(self.config.model_config)
            transcriber = create_transcriber(model_config, self.device)
        except (OSError, ValueError) as e:
            raise ChartModelError(f"모델 설정을 읽지 못함: {summarize_exception(e)}") from e
        tempo = create_tempo_estimator(self.config.tempo, self.device)
        try:
            load_sec = transcriber.load()
        except Exception as e:
            raise model_error_from(e, "모델 올리기") from e
        start = time.perf_counter()
        try:
            tempo.load()
        except Exception as e:
            transcriber.close()
            raise model_error_from(e, "bpm 모델 올리기") from e
        self.load_sec = load_sec + (time.perf_counter() - start)
        self._transcriber = transcriber
        self._model_config = model_config
        self._tempo = tempo
        return self.load_sec

    def transcribe_file(
        self,
        drum_stem_path: str | Path,
        out_dir: str | Path,
        on_progress: ProgressCallback | None = None,
        duration_ms: int | None = None,
    ) -> TranscriptionOutput:
        """드럼 트랙 파일 → out_dir/chart.json 저장 → TranscriptionOutput.

        duration_ms를 주면(워커가 BE claim의 원곡 길이를 넘김, 설계 U13) 노트 시각 상한과
        metrics.durationMs에 그 값을 씀. 없으면 드럼 트랙 길이.
        """
        self._require_loaded()
        notify = on_progress or _no_progress

        notify("LOAD_INPUT", 0.0)
        audio = read_audio_file(drum_stem_path, SAMPLE_RATE, self.config.max_duration_sec)
        length_ms = (
            duration_ms if duration_ms is not None else samples_to_ms(audio.shape[1], SAMPLE_RATE)
        )
        notify("LOAD_INPUT", 1.0)

        notify("TRANSCRIBE", 0.0)
        try:
            with measure_resources(self.device) as usage:
                result = self._transcriber.transcribe(audio, SAMPLE_RATE)
        except ChartError:
            raise
        except Exception as e:
            raise model_error_from(e, "채보") from e
        transcribe_ms = int(round(usage.elapsed_sec * 1000))
        notify("TRANSCRIBE", 1.0)

        notify("JSON", 0.0)
        try:
            tempo = self._tempo.estimate(audio, SAMPLE_RATE)
        except Exception as e:
            raise model_error_from(e, "bpm 추정") from e
        chart = build_chart(
            result.hits_pred,
            length_ms,
            tempo,
            self.model_version,
            transcribe_ms,
            schema_version=self.config.schema_version,
        )
        validate_chart(chart, length_ms)
        chart_path = _write_json(Path(out_dir) / CHART_FILENAME, chart)
        notify("JSON", 1.0)

        counts = notes_by_pad(chart)
        return TranscriptionOutput(
            chart_json_path=chart_path,
            chart=chart,
            n_notes=sum(counts.values()),
            notes_by_pad=counts,
            duration_ms=length_ms,
            bpm=tempo.bpm,
            raw_bpm=tempo.raw_bpm,
            first_beat_ms=tempo.first_beat_ms,
            first_downbeat_ms=tempo.first_downbeat_ms,
            bpm_estimated=tempo.estimated,
            bpm_method=tempo.method,
            model_name=self.model_name,
            model_version=self.model_version,
            load_ms=int(round((self.load_sec or 0.0) * 1000)),
            transcribe_ms=transcribe_ms,
            peak_vram_mb=_mb_or_none(usage.peak_vram_mb),
            peak_ram_mb=_mb_or_none(usage.peak_ram_mb),
        )

    def close(self) -> None:
        """모델 해제. load 전에 불러도 됨."""
        if self._transcriber is not None:
            self._transcriber.close()
            self._transcriber = None
            self._model_config = None
        if self._tempo is not None:
            self._tempo.close()
            self._tempo = None

    def _require_loaded(self) -> None:
        if not self.loaded:
            raise ChartModelError("load()를 먼저 호출")


def _write_json(path: Path, data: dict) -> Path:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as e:
        raise ChartOutputError(f"파일을 쓰지 못함: {path.name} ({summarize_exception(e)})") from e
    return path


def _no_progress(stage: str, fraction: float) -> None:
    return None
