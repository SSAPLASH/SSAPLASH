"""드럼 채보 추론 모듈. 드럼 트랙 파일 → 채보 JSON 파일 + TranscriptionOutput.

모델은 `configs/chart/transcription.yaml`의 `models` 중 `model` 이름(환경 변수 SSAPLASH_CHART_MODEL 우선)으로 고름.
흐름: TranscriptionModule(config).load() 한 번 → transcribe_file() 곡마다 → close().
진행 콜백 on_progress(stage, fraction): stage는 LOAD_INPUT·TRANSCRIBE·JSON.
채보 가능 검사: 드럼 트랙 무음, 1분당 노트 수 기준 미달, 박 추적 실패면 ChartNotTranscribableError.
generatorVersion은 `<모델 yaml name>@<해시 12자리>`. 모델 yaml·bpm 설정·시각 규칙 버전 중 하나만 바뀌어도 바뀜.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from ssaplash_ai.bench.datasets.base import SAMPLE_RATE
from ssaplash_ai.bench.datasets.pads import merge_pedal
from ssaplash_ai.bench.metrics.resource_usage import measure_resources
from ssaplash_ai.bench.transcribers import BaseTranscriber, TranscriberConfig, create_transcriber
from ssaplash_ai.chart.audio_io import duration_ms as samples_to_ms
from ssaplash_ai.chart.audio_io import read_audio_file
from ssaplash_ai.chart.chart_json import (
    TIMING_RULES_VERSION,
    build_chart,
    notes_by_pad,
    refine_chart_timing,
    validate_chart,
)
from ssaplash_ai.chart.config import DrumCheckConfig, TranscriptionConfig
from ssaplash_ai.chart.errors import (
    ChartError,
    ChartModelError,
    ChartNotTranscribableError,
    ChartOutputError,
    ChartSilentError,
    model_error_from,
    summarize_exception,
)
from ssaplash_ai.chart.separation import resolve_device
from ssaplash_ai.chart.tempo import TempoEstimate, TempoEstimator, create_tempo_estimator

STAGES = ("LOAD_INPUT", "TRANSCRIBE", "JSON")
CHART_FILENAME = "chart.json"
# 박 추정 입력. 원곡이 있으면 원곡, 없으면 드럼 트랙
BEAT_SOURCE_MIX = "mix"
BEAT_SOURCE_DRUMS = "drums"

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, float], None]


@dataclass
class TranscriptionOutput:
    """transcribe_file 결과. chart는 chart.json과 같은 내용."""

    chart_json_path: Path
    chart: dict
    n_notes: int
    notes_by_pad: dict[str, int]
    duration_ms: int
    # 채보 JSON bpm(보정 뒤). tracked_bpm은 박 추적 bpm(보정 전)
    bpm: float
    tracked_bpm: float
    # 노트로 bpm·offsetMs 다시 맞춘 결과(tempo_refine.RefineResult.to_dict). 보정을 껐거나 추정 실패면 None
    timing_refine: dict | None
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
    # 마디 첫 박 다수결 위치(TempoEstimate.downbeat_phase_ms). offsetMs의 노트 보정 전 값
    downbeat_phase_ms: int | None = None
    # 박 추정 입력(BEAT_SOURCE_MIX·BEAT_SOURCE_DRUMS)과 채보 JSON tempoMap 항목 수(없으면 0)
    beat_source: str = "drums"
    tempo_segments: int = 0

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
        """모델 yaml의 name (예: strum_crnn_songsterr_egmd)."""
        self._require_loaded()
        return self._model_config.name

    @property
    def model_version(self) -> str:
        """모델 yaml name + 해시 12자리(모델 yaml·bpm 방법·tempo 설정·시각 규칙 버전). 채보 JSON generatorVersion."""
        self._require_loaded()
        tempo = self.config.tempo
        key = "|".join(
            (
                self._model_config.config_hash,
                self._tempo.version_id,
                f"{tempo.min_bpm:g}-{tempo.max_bpm:g}",
                tempo.time_signature,
                TIMING_RULES_VERSION,
                tempo.origin,
                tempo.postprocess,
                f"{tempo.tempo_map}:{tempo.tempo_map_tolerance_ms:g}",
                # bpm 보정을 켜면 다른 값. 끄면 이전과 같은 generatorVersion
                *(("refine1",) if tempo.refine else ()),
            )
        )
        return f"{self._model_config.name}@{hashlib.sha256(key.encode()).hexdigest()[:12]}"

    def load(self) -> float:
        """모델 yaml 읽기 → 채보 모델 올리기 → bpm 모델 올리기. 올리는 데 걸린 초를 돌려줌."""
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
        beat_audio_path: str | Path | None = None,
    ) -> TranscriptionOutput:
        """드럼 트랙 파일 → out_dir/chart.json 저장 → TranscriptionOutput.

        duration_ms를 주면 노트 시각 상한과 metrics.durationMs에 그 값을 씀.
        beat_audio_path를 주면 박을 그 파일(원곡)에서 찾음. 읽지 못하면 드럼 트랙으로 함.
        """
        self._require_loaded()
        notify = on_progress or _no_progress

        notify("LOAD_INPUT", 0.0)
        try:
            audio = read_audio_file(drum_stem_path, SAMPLE_RATE, self.config.max_duration_sec)
        except ChartSilentError as e:
            raise ChartNotTranscribableError("드럼 트랙 무음") from e
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
        beat_audio, beat_source = audio, BEAT_SOURCE_DRUMS
        if beat_audio_path is not None:
            try:
                beat_audio = read_audio_file(
                    beat_audio_path, SAMPLE_RATE, self.config.max_duration_sec
                )
                beat_source = BEAT_SOURCE_MIX
            except Exception as e:  # 원곡을 못 읽어도 채보는 드럼 트랙 박으로 계속
                logger.warning("박 추정용 원곡을 못 읽어 드럼 트랙으로 함: %s", e)
        try:
            tempo = self._tempo.estimate(beat_audio, SAMPLE_RATE)
        except Exception as e:
            raise model_error_from(e, "bpm 추정") from e
        # 노래 파일 채보는 하이햇 페달을 따로 내지 않음(페달 예측 정확도 기준 미달). 모델이 내도 HIHAT으로 합침
        chart = build_chart(
            merge_pedal(result.hits_pred),
            length_ms,
            tempo,
            self.model_version,
            transcribe_ms,
            schema_version=self.config.schema_version,
            origin=self.config.tempo.origin,
        )
        refined = None
        if self.config.tempo.refine:
            cfg = self.config.tempo
            refined = refine_chart_timing(chart, tempo, cfg.min_bpm, cfg.max_bpm)
        counts = notes_by_pad(chart)
        check_transcribable(sum(counts.values()), length_ms, tempo, self.config.drum_check)
        validate_chart(chart, length_ms)
        chart_path = _write_json(Path(out_dir) / CHART_FILENAME, chart)
        notify("JSON", 1.0)

        return TranscriptionOutput(
            chart_json_path=chart_path,
            chart=chart,
            n_notes=sum(counts.values()),
            notes_by_pad=counts,
            duration_ms=length_ms,
            bpm=chart["charts"][0]["timing"]["bpm"],
            tracked_bpm=tempo.bpm,
            timing_refine=refined.to_dict() if refined else None,
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
            downbeat_phase_ms=tempo.downbeat_phase_ms,
            beat_source=beat_source,
            tempo_segments=len(chart["charts"][0]["timing"].get("tempoMap", [])),
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


def check_transcribable(
    n_notes: int, length_ms: int, tempo: TempoEstimate, check: DrumCheckConfig
) -> None:
    """채보를 만들 수 있는지. 노트 수를 먼저 보고, 통과하면 박 추적 결과를 봄.

    걸리면 ChartNotTranscribableError. 메시지는 실패 보고 summary로 나가므로 어느 경우인지 적음.
    """
    if check.min_notes_per_minute is not None and length_ms > 0:
        per_minute = n_notes * 60_000 / length_ms
        if per_minute < check.min_notes_per_minute:
            raise ChartNotTranscribableError(
                f"1분당 노트 {per_minute:.1f}개, 기준 {check.min_notes_per_minute:g}개"
            )
    if check.fail_on_unknown_tempo and not tempo.estimated:
        raise ChartNotTranscribableError(f"박 추적 실패, 박 {tempo.n_beats}개")


def _write_json(path: Path, data: dict) -> Path:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as e:
        raise ChartOutputError(f"파일을 쓰지 못함: {path.name} ({summarize_exception(e)})") from e
    return path


def _no_progress(stage: str, fraction: float) -> None:
    return None
