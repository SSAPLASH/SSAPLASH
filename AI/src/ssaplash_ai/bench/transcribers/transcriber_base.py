"""채보 모델 어댑터 공통 인터페이스.

어댑터는 "드럼(또는 원곡) 배열을 받아 타격 목록을 돌려주는" 같은 모양의 클래스. 하위 클래스는
모델 원래 라벨 그대로의 (시각, 라벨, 세기) 목록만 돌려주고, 라벨 → 패드 변환은 이 공통 틀이
yaml 대응표(labels)로 함. 대응표 값은 패드 9종 / 거친 라벨 tom·cymbal / __drop__(제외).
대응표에 tom·cymbal이 있으면 eight_pad가 거짓이 되어 8패드 점수는 매기지 않음.

흐름: TranscriberConfig.from_yaml → create_transcriber → load() → transcribe() 반복 → close().
입력은 분리 하네스와 같은 (채널 2, 샘플) float32·44.1kHz. 모델이 원하는 샘플레이트 변환은
어댑터 안에서 하고 그 시간도 채보 시간(RTF)에 들어감.
"""

from __future__ import annotations

import abc
import hashlib
import tempfile
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
import yaml

from ssaplash_ai.bench.datasets.gmd import midi_onsets
from ssaplash_ai.bench.datasets.pads import (
    COARSE,
    DROP,
    HITS_DTYPE,
    PRED_LABELS,
    SCORED_PADS,
    empty_hits,
    make_hits,
    validate_pred_hits,
)

MODELS_DIR = Path("data/models")

# (시각 초, 모델 원래 라벨, 세기 1~127 또는 None)
RawHit = tuple[float, object, int | None]


@dataclass
class TranscriberConfig:
    """configs/bench/transcribers/<어댑터>/*.yaml 한 파일. 어댑터마다 쓰는 필드가 다름."""

    name: str
    adapter: str
    license_code: str
    license_weights: str
    labels: dict = field(default_factory=dict)
    source_url: str = ""
    input_sample_rate: int = 44100
    velocity: bool = False
    # 가중치
    checkpoint_url: str | None = None
    checkpoint_path: str | None = None
    variant: str | None = None
    # 모델별 추가 설정. 비워 두면 저장소 기본값 (-107 규칙)
    thresholds: list[float] | None = None
    options: dict = field(default_factory=dict)
    # external
    python_exe: str | None = None
    script: str | None = None
    env_name: str | None = None
    # adtof_drumsep
    drumsep_config: str | None = None
    rules: dict = field(default_factory=dict)
    # 탐·심벌만 다른 ADTOF 가중치로 고를 때. "default"면 패키지 기본 가중치. 없으면 checkpoint_path 하나로 전부
    tom_checkpoint_path: str | None = None
    cymbal_checkpoint_path: str | None = None
    # 심벌 전용 가중치 결과를 쓰는 방식. take: 크래시·라이드 타격을 통째로, name: 이름만
    cymbal_mode: str = "take"
    # 점수를 같이 평균할 ADTOF 5종 가중치. [{path, columns}], columns는 ksthc 중 평균에 넣을 열 글자
    average_checkpoints: list[dict] = field(default_factory=list)
    # mock
    mock_mode: str = "truth"
    truth_dir: str | None = None
    shift_ms: float = 0.0
    fail_on_call: int | None = None
    yaml_text: str = field(default="", repr=False)
    source_path: Path | None = None

    @classmethod
    def from_yaml(cls, path: str | Path) -> TranscriberConfig:
        path = Path(path)
        text = path.read_text(encoding="utf-8")
        raw = yaml.safe_load(text)
        if not isinstance(raw, dict):
            raise ValueError(f"모델 설정이 비어 있음: {path}")
        cfg = cls.from_dict(raw)
        cfg.yaml_text = text
        cfg.source_path = path
        return cfg

    @classmethod
    def from_dict(cls, raw: dict) -> TranscriberConfig:
        for key in ("name", "adapter", "license_code", "license_weights"):
            if not raw.get(key):
                raise ValueError(f"모델 설정에 {key} 필드가 필요 (라이선스 문자열 필수, ADR-011)")
        for key in ("license_code", "license_weights"):
            if str(raw[key]).rstrip().endswith(("이슈", "(")):
                raise ValueError(f"{key} 값이 잘린 것 같음 (yaml에서 ' #'는 주석): {raw[key]!r}")
        known = {f for f in cls.__dataclass_fields__ if f not in ("yaml_text", "source_path")}
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 모델 설정 필드: {unknown}")
        kwargs = {k: v for k, v in raw.items() if v is not None}
        cfg = cls(**kwargs)
        cfg.validate_labels()
        cfg.yaml_text = yaml.safe_dump(raw, allow_unicode=True, sort_keys=True)
        return cfg

    def validate_labels(self) -> None:
        """대응표 값이 패드 9종·tom·cymbal·__drop__ 안에 있는지. 비어 있으면 오류."""
        if not self.labels:
            raise ValueError(f"{self.name}: labels(대응표)가 비어 있음")
        bad = sorted({str(v) for v in self.labels.values()} - set(PRED_LABELS) - {DROP})
        if bad:
            raise ValueError(
                f"{self.name}: 대응표 값이 어휘에 없음 {bad} (가능: {PRED_LABELS + (DROP,)})"
            )

    @property
    def eight_pad(self) -> bool:
        """거친 라벨이 없고 8패드가 전부 대응표에 나오면 참. HIHAT_PEDAL은 없어도 됨."""
        values = set(self.labels.values())
        return not (values & set(COARSE)) and set(SCORED_PADS) <= values

    @property
    def config_hash(self) -> str:
        """yaml 내용(대응표 포함)의 sha256 앞 12자리."""
        return hashlib.sha256(self.yaml_text.encode("utf-8")).hexdigest()[:12]

    @property
    def model_dir(self) -> Path:
        return MODELS_DIR / self.name


def map_label(labels: dict, label: object) -> str | None:
    """대응표에서 라벨을 찾음. yaml 키가 정수(MIDI 피치)면 문자열 키와도 맞춰 봄."""
    if label in labels:
        return labels[label]
    key = str(label)
    if key in labels:
        return labels[key]
    if key.lstrip("-").isdigit() and int(key) in labels:
        return labels[int(key)]
    return None


@dataclass
class TranscriberInfo:
    """모델 정보. 보고서 라이선스 열과 CSV 열에 사용."""

    name: str
    adapter: str
    checkpoint: str
    n_params: int | None
    license_code: str
    license_weights: str
    device: str
    eight_pad: bool
    has_velocity: bool


@dataclass
class TranscriptionResult:
    """transcribe 출력. hits_pred는 pads.HITS_DTYPE(pad에 거친 라벨 가능), 시각 오름차순."""

    hits_pred: np.ndarray
    hits_pred_dropped: int = 0
    raw_label_counts: dict[str, int] = field(default_factory=dict)
    n_out_of_range: int = 0
    # 어댑터가 직접 잰 값 (external 어댑터). None이면 러너가 measure_resources 값을 씀
    elapsed_sec: float | None = None
    peak_vram_mb: float | None = None
    vram_method: str | None = None


# ---- 공용 도우미 ----


def resample(audio: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """(채널, 샘플) → 같은 모양, 샘플레이트 변환. 같으면 그대로."""
    if sr_in == sr_out:
        return audio
    out = soxr.resample(np.ascontiguousarray(audio.T), sr_in, sr_out)
    return np.ascontiguousarray(out.T, dtype=np.float32)


def to_mono(audio: np.ndarray) -> np.ndarray:
    """(채널, 샘플) → (샘플,) 평균."""
    if audio.ndim == 1:
        return audio.astype(np.float32)
    return np.mean(audio, axis=0, dtype=np.float32)


def write_temp_wav(audio: np.ndarray, sample_rate: int, directory: Path | None = None) -> Path:
    """파일 입력만 받는 모델용 임시 wav. 호출한 쪽이 지움."""
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=directory, delete=False) as f:
        name = f.name
    sf.write(name, np.ascontiguousarray(audio.T), sample_rate, subtype="PCM_16")
    return Path(name)


def midi_raw_hits(path: Path) -> list[RawHit]:
    """MIDI 파일 → (시각, 피치, 세기) 목록. 피치가 원래 라벨."""
    return [(t, pitch, vel) for t, pitch, vel in midi_onsets(path)]


def apply_labels(
    raw: Iterable[RawHit], labels: dict, duration_sec: float | None = None
) -> TranscriptionResult:
    """원래 라벨 목록에 대응표를 적용해 예측 타격 표로. 모르는 라벨은 오류, __drop__은 개수만."""
    rows = list(raw)
    counts: dict[str, int] = {}
    out_of_range = 0
    kept: list[RawHit] = []
    for t, label, vel in rows:
        counts[str(label)] = counts.get(str(label), 0) + 1
        if duration_sec is not None and (t < 0 or t > duration_sec):
            out_of_range += 1
            continue
        kept.append((t, label, vel))
    # make_hits는 라벨을 그대로 키로 쓰므로 정수·문자열 키 차이를 여기서 맞춤
    table = {label: map_label(labels, label) for _, label, _ in kept}
    unknown = sorted(str(k) for k, v in table.items() if v is None)
    if unknown:
        raise ValueError(f"대응표에 없는 라벨: {unknown}")
    hits, dropped = make_hits(
        (t for t, _, _ in kept),
        (label for _, label, _ in kept),
        (vel for _, _, vel in kept),
        table,
        allow_coarse=True,
    )
    validate_pred_hits(hits)
    return TranscriptionResult(
        hits_pred=hits,
        hits_pred_dropped=dropped,
        raw_label_counts=counts,
        n_out_of_range=out_of_range,
    )


def hits_to_midi(hits: np.ndarray, path: Path, pad_pitch: dict[str, int] | None = None) -> Path:
    """예측 타격 표를 GM 드럼 MIDI로 저장 (--save-midi, 청취·플레이 평가용).

    note_on·note_off를 절대 틱으로 모아 정렬한 뒤 델타로 바꾼다. 타격 간격이 음 길이(50ms)보다 짧으면
    앞 음의 note_off가 뒤 음의 note_on보다 늦어 델타가 음수가 되므로 순서대로 쌓으면 안 된다.
    """
    import mido

    pitch = pad_pitch or GM_PAD_PITCH
    ticks_per_sec = 960  # 120bpm, ticks_per_beat 480
    note_ticks = 48  # 50ms
    events: list[tuple[int, int, str, int, int]] = []  # (틱, 순서, 종류, 피치, 세기)
    for row in hits:
        tick = int(round(float(row["time_sec"]) * ticks_per_sec))
        note = pitch.get(str(row["pad"]), 36)
        vel = int(row["velocity"]) if row["velocity"] > 0 else 100
        events.append((tick, 1, "note_on", note, vel))
        events.append((tick + note_ticks, 0, "note_off", note, 0))  # 같은 틱이면 off가 먼저
    events.sort(key=lambda ev: (ev[0], ev[1]))

    mid = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000))
    last = 0
    for tick, _, kind, note, vel in events:
        track.append(mido.Message(kind, note=note, velocity=vel, time=tick - last, channel=9))
        last = tick
    path.parent.mkdir(parents=True, exist_ok=True)
    mid.save(str(path))
    return path


# 저장용 GM 드럼 피치. 거친 라벨은 대표 피치
GM_PAD_PITCH: dict[str, int] = {
    "KICK": 36,
    "SNARE": 38,
    "HIHAT": 42,
    "SMALL_TOM": 50,
    "MID_TOM": 47,
    "FLOOR_TOM": 43,
    "CRASH": 49,
    "RIDE": 51,
    "HIHAT_PEDAL": 44,
    "tom": 47,
    "cymbal": 49,
}


class BaseTranscriber(abc.ABC):
    """어댑터 공통 뼈대. 하위 클래스는 _load·_transcribe·_checkpoint_id(·_n_params·_close)만 구현."""

    adapter: str = ""

    def __init__(self, config: TranscriberConfig, device: str = "cuda") -> None:
        self.config = config
        self.device = device
        self.load_sec: float | None = None
        self.loaded = False

    @property
    def name(self) -> str:
        return self.config.name

    def load(self) -> float:
        """가중치를 메모리에 올리고 걸린 초를 반환. 파일 다운로드(prepare)는 시간에서 뺌."""
        self.prepare()
        start = time.perf_counter()
        self._load()
        self.load_sec = time.perf_counter() - start
        self.loaded = True
        return self.load_sec

    def transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None = None
    ) -> TranscriptionResult:
        """(채널 2, 샘플) 드럼 또는 원곡 → 예측 타격 표. song_id는 mock·external이 쓰는 힌트."""
        if not self.loaded:
            raise RuntimeError(f"{self.name}: load()를 먼저 호출")
        audio = np.ascontiguousarray(audio, dtype=np.float32)
        if audio.ndim == 1:
            audio = np.stack([audio, audio])
        duration = audio.shape[1] / sample_rate
        raw = self._transcribe(audio, sample_rate, song_id)
        return apply_labels(raw, self.config.labels, duration)

    def info(self) -> TranscriberInfo:
        return TranscriberInfo(
            name=self.name,
            adapter=self.adapter,
            checkpoint=self._checkpoint_id(),
            n_params=self._n_params(),
            license_code=self.config.license_code,
            license_weights=self.config.license_weights,
            device=self.device,
            eight_pad=self.config.eight_pad,
            has_velocity=bool(self.config.velocity),
        )

    def close(self) -> None:
        self._close()
        self.loaded = False

    # ---- 하위 클래스 구현 ----

    def prepare(self) -> None:  # noqa: B027 - 기본은 받을 파일이 없음
        """가중치 다운로드 등 load 시간에 넣지 않을 준비 작업."""

    @abc.abstractmethod
    def _load(self) -> None: ...

    @abc.abstractmethod
    def _transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None
    ) -> Sequence[RawHit]:
        """모델 원래 라벨 그대로의 (시각, 라벨, 세기 또는 None) 목록."""

    @abc.abstractmethod
    def _checkpoint_id(self) -> str: ...

    def _n_params(self) -> int | None:
        return None

    def _close(self) -> None:  # noqa: B027 - 기본은 해제할 것이 없음
        pass


__all__ = [
    "GM_PAD_PITCH",
    "HITS_DTYPE",
    "MODELS_DIR",
    "BaseTranscriber",
    "RawHit",
    "TranscriberConfig",
    "TranscriberInfo",
    "TranscriptionResult",
    "apply_labels",
    "empty_hits",
    "hits_to_midi",
    "map_label",
    "midi_raw_hits",
    "resample",
    "to_mono",
    "write_temp_wav",
]
