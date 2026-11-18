"""서비스 설정 읽기. `configs/chart/*.yaml` → SeparationConfig·TranscriptionConfig·MusicCheckConfig.

yaml의 상대 경로는 AI/ 폴더 기준. 아래 환경 변수가 yaml 값을 덮어씀.
- SSAPLASH_CHART_DEVICE: 장치(cuda / cpu)
- SSAPLASH_MODELS_DIR: 가중치 폴더. 기본 data/models
- SSAPLASH_WORK_DIR: 명령줄 --out이 없을 때 출력 폴더의 부모
- SSAPLASH_CHART_MODEL: 채보 모델 이름. transcription.yaml의 model 값보다 우선
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ENV_DEVICE = "SSAPLASH_CHART_DEVICE"
ENV_MODELS_DIR = "SSAPLASH_MODELS_DIR"
ENV_WORK_DIR = "SSAPLASH_WORK_DIR"
# 채보 모델 이름. 있으면 transcription.yaml의 model 값 대신 씀 (models 목록 안의 이름)
ENV_CHART_MODEL = "SSAPLASH_CHART_MODEL"

DEFAULT_SEPARATION_CONFIG = Path("configs/chart/separation.yaml")
DEFAULT_TRANSCRIPTION_CONFIG = Path("configs/chart/transcription.yaml")
DEFAULT_MUSIC_CHECK_CONFIG = Path("configs/chart/music_check.yaml")
OUTPUT_FORMATS = ("flac", "wav")
# beat_this: 서비스, librosa: torch 없이 도는 mock·테스트용
TEMPO_METHODS = ("beat_this", "librosa")
# offsetMs 원점 방식. downbeat: Beat This! 첫 마디 첫 박 그대로, notes: 킥·스네어 노트로 박 안 위치 보정
ORIGIN_MODES = ("downbeat", "notes")
# Beat This! 후처리. minimal: 확률 봉우리 그대로, dbn: madmom DBN으로 박 간격·마디 길이를 고르게
TEMPO_POSTPROCESS = ("minimal", "dbn")
# BE WorkerResults가 schemaVersion 1만 받음
SCHEMA_VERSIONS = (1,)


@dataclass
class OutputConfig:
    """드럼 트랙·반주 파일 형식. flac은 16비트 무손실, wav는 PCM_16."""

    sample_rate: int = 44100
    format: str = "flac"

    @classmethod
    def from_dict(cls, raw: dict | None) -> OutputConfig:
        raw = raw or {}
        unknown = sorted(set(raw) - {"sample_rate", "format"})
        if unknown:
            raise ValueError(f"모르는 output 필드: {unknown}")
        fmt = str(raw.get("format", cls.format)).lower()
        if fmt not in OUTPUT_FORMATS:
            raise ValueError(f"output.format은 {OUTPUT_FORMATS} 중 하나: {fmt!r}")
        sample_rate = int(raw.get("sample_rate", cls.sample_rate))
        if sample_rate <= 0:
            raise ValueError(f"output.sample_rate는 양수: {sample_rate}")
        return cls(sample_rate=sample_rate, format=fmt)


@dataclass
class ChartConfig:
    """`configs/chart/*.yaml` 공통 부분. 모델 yaml 경로와 장치."""

    model_config: Path
    device: str = "cuda"
    source_path: Path | None = field(default=None, repr=False)


@dataclass
class SeparationConfig(ChartConfig):
    """`configs/chart/separation.yaml` 한 파일."""

    output: OutputConfig = field(default_factory=OutputConfig)
    max_duration_sec: float = 600.0

    @classmethod
    def from_yaml(cls, path: str | Path = DEFAULT_SEPARATION_CONFIG) -> SeparationConfig:
        path = Path(path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"분리 설정이 비어 있음: {path}")
        return cls.from_dict(raw, source_path=path)

    @classmethod
    def from_dict(cls, raw: dict, source_path: Path | None = None) -> SeparationConfig:
        known = {"model_config", "device", "output", "max_duration_sec"}
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 분리 설정 필드: {unknown}")
        if not raw.get("model_config"):
            raise ValueError("분리 설정에 model_config(모델 yaml 경로)가 필요")
        max_duration = float(raw.get("max_duration_sec", cls.max_duration_sec))
        if max_duration <= 0:
            raise ValueError(f"max_duration_sec는 양수: {max_duration}")
        return cls(
            model_config=Path(str(raw["model_config"])),
            device=resolve_device_setting(str(raw.get("device", cls.device))),
            source_path=source_path,
            output=OutputConfig.from_dict(raw.get("output")),
            max_duration_sec=max_duration,
        )


@dataclass
class TempoConfig:
    """bpm 추정 설정. 추정값이 [min_bpm, max_bpm] 밖이면 2배·절반으로 접어 넣음."""

    method: str = "beat_this"
    min_bpm: float = 60.0
    max_bpm: float = 200.0
    time_signature: str = "4/4"
    # offsetMs 원점 방식. ORIGIN_MODES 중 하나
    origin: str = "downbeat"
    # Beat This! 후처리. TEMPO_POSTPROCESS 중 하나
    postprocess: str = "minimal"
    # 찾은 박을 따라가는 빠르기 구간(tempoMap)을 낼지
    tempo_map: bool = False
    # 빠르기 구간 묶음 허용(ms). 구간 안 마디 경계가 모두 이 거리 안이면 한 구간으로 묶음
    tempo_map_tolerance_ms: float = 20.0
    # 채보 노트로 bpm·offsetMs 다시 맞추기(chart/tempo_refine.py). 끄면 박 추적 bpm 그대로
    refine: bool = False

    @classmethod
    def from_dict(cls, raw: dict | None) -> TempoConfig:
        raw = raw or {}
        known = {"method", "min_bpm", "max_bpm", "time_signature", "origin", "postprocess"}
        known |= {"tempo_map", "tempo_map_tolerance_ms", "refine"}
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 tempo 필드: {unknown}")
        method = str(raw.get("method", cls.method)).lower()
        if method not in TEMPO_METHODS:
            raise ValueError(f"tempo.method는 {TEMPO_METHODS} 중 하나: {method!r}")
        min_bpm = float(raw.get("min_bpm", cls.min_bpm))
        max_bpm = float(raw.get("max_bpm", cls.max_bpm))
        # 2배·절반 접기가 항상 범위 안에 떨어지려면 상한이 하한의 2배 이상이어야 함
        if min_bpm <= 0 or max_bpm < 2 * min_bpm:
            raise ValueError(
                f"tempo 범위는 0 < min_bpm, max_bpm >= 2 * min_bpm: {min_bpm}, {max_bpm}"
            )
        time_signature = str(raw.get("time_signature", cls.time_signature))
        if not re.fullmatch(r"[1-9][0-9]?/(1|2|4|8|16|32)", time_signature):
            raise ValueError(f"tempo.time_signature 형식 오류 (예: 4/4): {time_signature!r}")
        origin = str(raw.get("origin", cls.origin)).lower()
        if origin not in ORIGIN_MODES:
            raise ValueError(f"tempo.origin은 {ORIGIN_MODES} 중 하나: {origin!r}")
        postprocess = str(raw.get("postprocess", cls.postprocess)).lower()
        if postprocess not in TEMPO_POSTPROCESS:
            raise ValueError(f"tempo.postprocess는 {TEMPO_POSTPROCESS} 중 하나: {postprocess!r}")
        tempo_map = raw.get("tempo_map", cls.tempo_map)
        if not isinstance(tempo_map, bool):
            raise ValueError(f"tempo.tempo_map은 true/false: {tempo_map!r}")
        tolerance = float(raw.get("tempo_map_tolerance_ms", cls.tempo_map_tolerance_ms))
        if not tolerance > 0:
            raise ValueError(f"tempo.tempo_map_tolerance_ms는 양수: {tolerance}")
        refine = raw.get("refine", cls.refine)
        if not isinstance(refine, bool):
            raise ValueError(f"tempo.refine은 true 또는 false: {refine!r}")
        return cls(
            method=method,
            min_bpm=min_bpm,
            max_bpm=max_bpm,
            time_signature=time_signature,
            origin=origin,
            postprocess=postprocess,
            tempo_map=tempo_map,
            tempo_map_tolerance_ms=tolerance,
            refine=refine,
        )


@dataclass
class DrumCheckConfig:
    """채보 가능 검사. 걸리면 NOT_TRANSCRIBABLE 실패. min_notes_per_minute가 None이면 노트 수 검사를 하지 않음."""

    min_notes_per_minute: float | None = None
    fail_on_unknown_tempo: bool = True

    @classmethod
    def from_dict(cls, raw: dict | None) -> DrumCheckConfig:
        raw = raw or {}
        unknown = sorted(set(raw) - {"min_notes_per_minute", "fail_on_unknown_tempo"})
        if unknown:
            raise ValueError(f"모르는 drum_check 필드: {unknown}")
        min_notes = raw.get("min_notes_per_minute")
        if min_notes is not None:
            min_notes = float(min_notes)
            if min_notes <= 0:
                raise ValueError(f"drum_check.min_notes_per_minute는 양수 또는 비움: {min_notes}")
        fail_on_unknown = raw.get("fail_on_unknown_tempo", cls.fail_on_unknown_tempo)
        if not isinstance(fail_on_unknown, bool):
            raise ValueError(f"drum_check.fail_on_unknown_tempo는 true/false: {fail_on_unknown!r}")
        return cls(min_notes_per_minute=min_notes, fail_on_unknown_tempo=fail_on_unknown)


@dataclass
class TranscriptionConfig(ChartConfig):
    """`configs/chart/transcription.yaml` 한 파일.

    채보 모델은 `models`(이름 → 모델 yaml 경로) 중 `model` 이름으로 고름. 환경 변수 SSAPLASH_CHART_MODEL이
    있으면 그 이름이 우선. `models` 없이 `model_config` 경로를 바로 적는 옛 형식도 받음.
    """

    schema_version: int = 1
    # 고른 모델 이름. 옛 형식(model_config만)이면 None
    model_name: str | None = None
    # 고를 수 있는 모델 이름 → 모델 yaml 경로
    models: dict[str, Path] = field(default_factory=dict)
    tempo: TempoConfig = field(default_factory=TempoConfig)
    max_duration_sec: float = 600.0
    drum_check: DrumCheckConfig = field(default_factory=DrumCheckConfig)

    @classmethod
    def from_yaml(cls, path: str | Path = DEFAULT_TRANSCRIPTION_CONFIG) -> TranscriptionConfig:
        path = Path(path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"채보 설정이 비어 있음: {path}")
        return cls.from_dict(raw, source_path=path)

    @classmethod
    def from_dict(cls, raw: dict, source_path: Path | None = None) -> TranscriptionConfig:
        known = {
            "model",
            "models",
            "model_config",
            "device",
            "schema_version",
            "tempo",
            "max_duration_sec",
            "drum_check",
        }
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 채보 설정 필드: {unknown}")
        models = {str(k): Path(str(v)) for k, v in (raw.get("models") or {}).items()}
        name = os.environ.get(ENV_CHART_MODEL) or raw.get("model")
        if models:
            if raw.get("model_config"):
                raise ValueError("채보 설정에 models와 model_config를 같이 쓸 수 없음")
            if not name:
                raise ValueError(f"채보 설정에 model(쓸 모델 이름)이 필요. 가능: {sorted(models)}")
            if str(name) not in models:
                raise ValueError(f"모르는 채보 모델 이름 {name!r}. 가능: {sorted(models)}")
            model_config = models[str(name)]
        elif raw.get("model_config"):
            model_config, name = Path(str(raw["model_config"])), None
        else:
            raise ValueError(
                "채보 설정에 models·model이나 model_config(채보 모델 yaml 경로)가 필요"
            )
        schema_version = int(raw.get("schema_version", cls.schema_version))
        if schema_version not in SCHEMA_VERSIONS:
            raise ValueError(f"schema_version은 {SCHEMA_VERSIONS} 중 하나: {schema_version}")
        max_duration = float(raw.get("max_duration_sec", cls.max_duration_sec))
        if max_duration <= 0:
            raise ValueError(f"max_duration_sec는 양수: {max_duration}")
        return cls(
            model_config=model_config,
            device=resolve_device_setting(str(raw.get("device", cls.device))),
            source_path=source_path,
            schema_version=schema_version,
            model_name=str(name) if name else None,
            models=models,
            tempo=TempoConfig.from_dict(raw.get("tempo")),
            max_duration_sec=max_duration,
            drum_check=DrumCheckConfig.from_dict(raw.get("drum_check")),
        )


@dataclass
class MusicCheckConfig:
    """`configs/chart/music_check.yaml` 한 파일. 분리 전에 원곡이 음악인지 보는 검사.

    음악 확률 평균이 min_music_prob 미만이거나 말소리 확률 평균이 max_speech_prob 이상이면 NOT_TRANSCRIBABLE.
    기준값 두 개가 모두 None이면 검사하지 않고 모델도 올리지 않음. 장치는 SSAPLASH_CHART_DEVICE를 따르지 않음.
    """

    model: str = "MIT/ast-finetuned-audioset-10-10-0.4593"
    device: str = "cpu"
    min_music_prob: float | None = None
    max_speech_prob: float | None = None
    positions: tuple[float, ...] = (0.2, 0.4, 0.6, 0.8)
    window_sec: float = 10.0
    max_duration_sec: float = 600.0
    source_path: Path | None = field(default=None, repr=False)

    @property
    def enabled(self) -> bool:
        """기준값이 하나라도 있으면 검사함."""
        return self.min_music_prob is not None or self.max_speech_prob is not None

    @classmethod
    def from_yaml(cls, path: str | Path = DEFAULT_MUSIC_CHECK_CONFIG) -> MusicCheckConfig:
        path = Path(path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"음악 여부 검사 설정이 비어 있음: {path}")
        return cls.from_dict(raw, source_path=path)

    @classmethod
    def from_dict(cls, raw: dict, source_path: Path | None = None) -> MusicCheckConfig:
        known = {"model", "device", "min_music_prob", "max_speech_prob", "positions"}
        known |= {"window_sec", "max_duration_sec"}
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 음악 여부 검사 설정 필드: {unknown}")
        model = str(raw.get("model", cls.model)).strip()
        if not model:
            raise ValueError("음악 여부 검사 설정의 model이 비어 있음")
        thresholds = {}
        for name in ("min_music_prob", "max_speech_prob"):
            value = raw.get(name)
            if value is not None:
                value = float(value)
                if not 0.0 < value < 1.0:
                    raise ValueError(f"{name}은 0과 1 사이 또는 비움: {value}")
            thresholds[name] = value
        positions = raw.get("positions", cls.positions)
        if not isinstance(positions, (list, tuple)) or not positions:
            raise ValueError(f"positions는 비어 있지 않은 목록: {positions!r}")
        positions = tuple(float(p) for p in positions)
        if any(not 0.0 <= p <= 1.0 for p in positions):
            raise ValueError(f"positions는 0과 1 사이 비율: {positions}")
        window_sec = float(raw.get("window_sec", cls.window_sec))
        if window_sec <= 0:
            raise ValueError(f"window_sec는 양수: {window_sec}")
        max_duration = float(raw.get("max_duration_sec", cls.max_duration_sec))
        if max_duration <= 0:
            raise ValueError(f"max_duration_sec는 양수: {max_duration}")
        return cls(
            model=model,
            device=str(raw.get("device", cls.device)),
            min_music_prob=thresholds["min_music_prob"],
            max_speech_prob=thresholds["max_speech_prob"],
            positions=positions,
            window_sec=window_sec,
            max_duration_sec=max_duration,
            source_path=source_path,
        )


def resolve_device_setting(device: str) -> str:
    """환경 변수 SSAPLASH_CHART_DEVICE가 있으면 그 값, 없으면 yaml 값."""
    return os.environ.get(ENV_DEVICE) or device


def work_dir_from_env() -> Path | None:
    """SSAPLASH_WORK_DIR이 있으면 그 경로, 없으면 None."""
    value = os.environ.get(ENV_WORK_DIR)
    return Path(value) if value else None
