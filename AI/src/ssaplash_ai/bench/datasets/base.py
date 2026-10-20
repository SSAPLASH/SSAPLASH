"""벤치마크 데이터셋 공통 인터페이스.

설계 문서 3-1절 "데이터셋 항목"을 그대로 옮긴 것. 로더는 곡 하나를
원곡·정답 드럼·정답 반주 배열로 반환. runner는 이 모양을 전제로 동작.
배열은 전부 float32, 모양은 (채널 2, 샘플), 샘플레이트는 44100으로 통일.
"""

from __future__ import annotations

import abc
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
import yaml

SAMPLE_RATE = 44100


@dataclass
class SongItem:
    """곡 하나. 설계 3-1절 표의 필드를 snake_case로 옮긴 것."""

    dataset: str
    song_id: str
    sample_rate: int
    mixture: np.ndarray
    drums_true: np.ndarray
    accomp_true: np.ndarray
    clip: tuple[float, float] | None = None
    onsets_true: np.ndarray | None = None

    @property
    def duration_sec(self) -> float:
        return self.mixture.shape[1] / self.sample_rate


@dataclass
class CheckReport:
    """데이터 점검 결과. cli의 check-data가 출력."""

    dataset: str
    song_count: int
    total_duration_sec: float
    missing: list[str]
    expected_songs: int | None = None

    @property
    def ok(self) -> bool:
        if self.missing:
            return False
        if self.expected_songs is not None and self.song_count != self.expected_songs:
            return False
        return True


@dataclass
class DatasetConfig:
    """configs/bench/datasets/*.yaml 한 파일.

    root가 상대 경로면 현재 작업 폴더 기준. README대로 AI/ 에서 실행.
    """

    name: str
    kind: str
    root: Path
    sample_rate: int = SAMPLE_RATE
    subset: str | None = None
    songs: list[str] | None = None
    clip: tuple[float, float] | None = None
    expected_songs: int | None = None

    @classmethod
    def from_yaml(cls, path: str | Path) -> DatasetConfig:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"데이터셋 설정이 비어 있음: {path}")
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict) -> DatasetConfig:
        clip = raw.get("clip")
        return cls(
            name=str(raw["name"]),
            kind=str(raw["kind"]),
            root=Path(raw["root"]),
            sample_rate=int(raw.get("sample_rate", SAMPLE_RATE)),
            subset=raw.get("subset"),
            songs=[str(s) for s in raw["songs"]] if raw.get("songs") else None,
            clip=(float(clip[0]), float(clip[1])) if clip else None,
            expected_songs=raw.get("expected_songs"),
        )


# ---------- 오디오 공용 함수 ----------


def read_audio(
    path: str | Path,
    sample_rate: int = SAMPLE_RATE,
    clip: tuple[float, float] | None = None,
) -> np.ndarray:
    """wav를 읽어 (2, 샘플) float32로 반환.

    clip이 있으면 원본 샘플레이트 기준으로 그 구간만 읽은 뒤 변환.
    모노는 양쪽 채널에 복사, 3채널 이상은 앞 두 채널만 사용.
    """
    info = sf.info(str(path))
    start = 0
    stop = None
    if clip is not None:
        start = int(round(clip[0] * info.samplerate))
        stop = int(round(clip[1] * info.samplerate))
    data, sr = sf.read(str(path), dtype="float32", always_2d=True, start=start, stop=stop)
    if sr != sample_rate:
        data = soxr.resample(data, sr, sample_rate).astype(np.float32)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    return np.ascontiguousarray(data.T, dtype=np.float32)


def write_audio(path: str | Path, audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    """(2, 샘플) 배열을 24비트 wav로 저장."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio.T, sample_rate, subtype="PCM_24")


def audio_duration_sec(path: str | Path) -> float:
    """헤더만 읽어 길이를 초 단위로 반환."""
    info = sf.info(str(path))
    return info.frames / info.samplerate


def match_length(*arrays: np.ndarray) -> tuple[np.ndarray, ...]:
    """길이가 다른 배열들을 가장 짧은 길이로 맞춤."""
    n = min(a.shape[1] for a in arrays)
    return tuple(a[:, :n] for a in arrays)


# ---------- 로더 기본 클래스 ----------


class BaseDataset(abc.ABC):
    """데이터셋 로더 공통 뼈대. 하위 클래스는 세 메서드만 구현."""

    kind: str = ""

    def __init__(self, config: DatasetConfig) -> None:
        self.config = config

    @property
    def name(self) -> str:
        return self.config.name

    @abc.abstractmethod
    def song_ids(self) -> list[str]:
        """곡 식별자 목록. 설정에 songs가 있으면 그 목록, 없으면 폴더 탐색."""

    @abc.abstractmethod
    def required_files(self, song_id: str) -> list[Path]:
        """곡 하나를 읽는 데 꼭 필요한 파일 목록. 첫 번째는 원곡 파일."""

    @abc.abstractmethod
    def load(self, song_id: str) -> SongItem:
        """곡 하나를 읽어 SongItem으로 반환."""

    def __iter__(self) -> Iterator[SongItem]:
        for song_id in self.song_ids():
            yield self.load(song_id)

    def __len__(self) -> int:
        return len(self.song_ids())

    def check(self) -> CheckReport:
        """파일 유무와 길이만 확인. 오디오 본문은 읽지 않음."""
        missing: list[str] = []
        total = 0.0
        ids = self.song_ids()
        for song_id in ids:
            files = self.required_files(song_id)
            for f in files:
                if not f.is_file():
                    missing.append(f"{song_id}/{f.name}")
            if files and files[0].is_file():
                total += audio_duration_sec(files[0])
        return CheckReport(
            dataset=self.name,
            song_count=len(ids),
            total_duration_sec=total,
            missing=missing,
            expected_songs=self.config.expected_songs,
        )

    def _read(self, path: Path) -> np.ndarray:
        return read_audio(path, self.config.sample_rate, self.config.clip)
