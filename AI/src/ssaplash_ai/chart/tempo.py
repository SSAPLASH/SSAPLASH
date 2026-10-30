"""bpm 추정 (설계 3장 채보 JSON `timing`, U4·U14·U15).

방법은 설정 `tempo.method`로 고름.
- beat_this(서비스): Beat This!(CPJKU, ISMIR 2024, 코드·가중치 MIT)로 박과 마디 첫 박 시각을 구함.
  GMD test 45곡에서 정답 bpm ±2% 안에 45곡이 들어 librosa(25곡)·madmom(32곡)보다 나았음(설계 U15)
- librosa: `beat.beat_track`. torch 없이 돌아서 mock 설정과 테스트용으로 남김

박 시각에서 bpm을 계산하는 방법은 둘이 같음. 박 간격 중앙값에서 15% 넘게 벗어난 간격(박을 건너뛰거나
두 번 잡은 곳)을 빼고 나머지 평균으로 bpm을 구하고, [min_bpm, max_bpm] 밖이면 2배·절반으로 접어 넣음.
템포가 바뀌는 곡도 bpm 하나로 냄(가변 템포는 범위 밖).

박을 못 찾으면(타격이 거의 없는 드럼 트랙) BE가 받는 기본값 120을 쓰고 estimated를 거짓으로 둠.
첫 박·첫 마디 시각은 결과 메타에만 남김. 채보 JSON의 offsetMs는 0(U14).

Beat This! 가중치는 SSAPLASH_MODELS_DIR(기본 data/models)/beat_this/에 두고 md5로 확인함. 없으면 공식 서버,
안 되면 개발자 사이트에서 받음(2026-10 공식 서버 고장, GitHub 이슈 #20·#23).
"""

from __future__ import annotations

import abc
import hashlib
import math
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soxr

from ssaplash_ai.chart.config import ENV_MODELS_DIR, TempoConfig

LIBROSA_SAMPLE_RATE = 22050
FALLBACK_BPM = 120.0
# 박 간격 중앙값에서 이 비율 넘게 벗어난 간격은 bpm 계산에서 뺌
INTERVAL_TOLERANCE = 0.15
MIN_INTERVALS = 3

BEAT_THIS_CHECKPOINT = "final0"
# 개발자가 GitHub 이슈 #20에 올린 md5
BEAT_THIS_MD5 = {"final0": "9fdf5e3f69b9996870e7aecd69527b08"}
BEAT_THIS_URLS = (
    "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/{name}.ckpt",
    "https://f0k.de/pubs/2024_ismir/beat_this-{name}.ckpt",
)
DOWNLOAD_TIMEOUT_SEC = 60
DEFAULT_MODELS_DIR = Path("data/models")


@dataclass
class TempoEstimate:
    """bpm 추정 결과. bpm은 박 간격으로 계산하고 접은 값(소수 둘째 자리), raw_bpm은 접기 전 값."""

    bpm: float
    raw_bpm: float | None
    first_beat_ms: int | None
    first_downbeat_ms: int | None
    n_beats: int
    time_signature: str
    estimated: bool
    method: str


def fold_bpm(bpm: float, min_bpm: float, max_bpm: float) -> float:
    """[min_bpm, max_bpm] 안에 들 때까지 2배 또는 절반. max_bpm >= 2 * min_bpm이면 항상 끝남."""
    while bpm < min_bpm:
        bpm *= 2.0
    while bpm > max_bpm:
        bpm /= 2.0
    return bpm


def bpm_from_beats(beats: np.ndarray) -> float | None:
    """박 시각(초) → 박 간격으로 계산한 bpm. 쓸 간격이 MIN_INTERVALS 미만이면 None."""
    if beats.size < 2:
        return None
    intervals = np.diff(beats)
    median = float(np.median(intervals))
    if median <= 0:
        return None
    kept = intervals[np.abs(intervals - median) <= INTERVAL_TOLERANCE * median]
    if kept.size < MIN_INTERVALS:
        return None
    return 60.0 / float(np.mean(kept))


def _ms(seconds: np.ndarray) -> int | None:
    return int(round(float(seconds[0]) * 1000)) if seconds.size else None


def estimate_from_beats(
    beats: np.ndarray,
    downbeats: np.ndarray | None,
    config: TempoConfig,
    method: str,
    hint_bpm: float | None = None,
) -> TempoEstimate:
    """박 시각 → TempoEstimate. 박 간격으로 bpm을 못 구하면 hint_bpm(librosa 템포 값), 그것도 없으면 120."""
    beats = np.asarray(beats, dtype=np.float64)
    downbeats = np.asarray(downbeats if downbeats is not None else [], dtype=np.float64)
    raw = bpm_from_beats(beats)
    if raw is None and hint_bpm is not None and math.isfinite(hint_bpm) and hint_bpm > 0:
        raw = hint_bpm
    if raw is None:
        return TempoEstimate(
            bpm=FALLBACK_BPM,
            raw_bpm=None,
            first_beat_ms=_ms(beats),
            first_downbeat_ms=_ms(downbeats),
            n_beats=int(beats.size),
            time_signature=config.time_signature,
            estimated=False,
            method=method,
        )
    return TempoEstimate(
        bpm=round(fold_bpm(raw, config.min_bpm, config.max_bpm), 2),
        raw_bpm=round(raw, 2),
        first_beat_ms=_ms(beats),
        first_downbeat_ms=_ms(downbeats),
        n_beats=int(beats.size),
        time_signature=config.time_signature,
        estimated=True,
        method=method,
    )


def _mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 2:
        return np.mean(audio, axis=0, dtype=np.float32)
    return audio.astype(np.float32)


class TempoEstimator(abc.ABC):
    """bpm 추정기 공통 틀. load() 한 번 → estimate() 곡마다 → close()."""

    method: str = ""

    def __init__(self, config: TempoConfig, device: str = "cpu") -> None:
        self.config = config
        self.device = device

    def load(self) -> None:  # noqa: B027 - 기본은 올릴 모델이 없음
        """모델 준비. 실패하면 예외(TranscriptionModule이 모델 오류로 감쌈)."""

    @abc.abstractmethod
    def estimate(self, audio: np.ndarray, sample_rate: int) -> TempoEstimate:
        """(채널, 샘플) 드럼 트랙 → TempoEstimate."""

    @property
    def version_id(self) -> str:
        """generatorVersion 해시에 넣는 값. 방법이나 가중치가 바뀌면 바뀜."""
        return self.method

    def close(self) -> None:  # noqa: B027 - 기본은 해제할 것이 없음
        pass


class LibrosaTempo(TempoEstimator):
    """librosa beat_track. 모노 22050Hz로 바꿔 돌림. torch가 필요 없음."""

    method = "librosa"

    def estimate(self, audio: np.ndarray, sample_rate: int) -> TempoEstimate:
        import librosa

        mono = _mono(audio)
        if sample_rate != LIBROSA_SAMPLE_RATE:
            mono = soxr.resample(mono, sample_rate, LIBROSA_SAMPLE_RATE).astype(np.float32)
        tempo, beats = librosa.beat.beat_track(y=mono, sr=LIBROSA_SAMPLE_RATE, units="time")
        hint = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else None
        return estimate_from_beats(np.asarray(beats), None, self.config, self.method, hint)


def models_dir() -> Path:
    """가중치 폴더. SSAPLASH_MODELS_DIR이 있으면 그 값, 없으면 data/models."""
    value = os.environ.get(ENV_MODELS_DIR)
    return Path(value) if value else DEFAULT_MODELS_DIR


def file_md5(path: Path) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_beat_this_checkpoint(
    name: str = BEAT_THIS_CHECKPOINT,
    directory: Path | None = None,
    urls: tuple[str, ...] = BEAT_THIS_URLS,
) -> Path:
    """가중치 파일 경로. 없거나 md5가 다르면 urls 순서대로 받아 md5가 맞는 것만 남김. 다 실패하면 RuntimeError."""
    expected = BEAT_THIS_MD5[name]
    directory = directory or models_dir() / "beat_this"
    path = directory / f"beat_this-{name}.ckpt"
    if path.is_file() and file_md5(path) == expected:
        return path
    directory.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    failures: list[str] = []
    for template in urls:
        url = template.format(name=name)
        try:
            with (
                urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SEC) as resp,
                open(tmp, "wb") as f,
            ):
                while chunk := resp.read(1 << 20):
                    f.write(chunk)
        except Exception as e:
            failures.append(f"{url.split('/')[2]}: {type(e).__name__}")
            continue
        got = file_md5(tmp)
        if got != expected:
            failures.append(f"{url.split('/')[2]}: md5 불일치")
            continue
        tmp.replace(path)
        return path
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"Beat This! 가중치를 받지 못함 ({'; '.join(failures)})")


class BeatThisTempo(TempoEstimator):
    """Beat This! final0. 박과 마디 첫 박을 냄. 입력 샘플레이트 변환은 Beat This!가 함."""

    method = "beat_this"

    def __init__(self, config: TempoConfig, device: str = "cpu") -> None:
        super().__init__(config, device)
        self._model = None
        self.checkpoint_path: Path | None = None

    def load(self) -> None:
        from beat_this.inference import Audio2Beats

        self.checkpoint_path = ensure_beat_this_checkpoint()
        self._model = Audio2Beats(
            checkpoint_path=str(self.checkpoint_path), device=self.device, dbn=False
        )

    def estimate(self, audio: np.ndarray, sample_rate: int) -> TempoEstimate:
        if self._model is None:
            raise RuntimeError("Beat This!: load()를 먼저 호출")
        beats, downbeats = self._model(_mono(audio), sample_rate)
        return estimate_from_beats(
            np.asarray(beats), np.asarray(downbeats), self.config, self.method
        )

    @property
    def version_id(self) -> str:
        return f"{self.method}:{BEAT_THIS_CHECKPOINT}:{BEAT_THIS_MD5[BEAT_THIS_CHECKPOINT]}"

    def close(self) -> None:
        self._model = None


ESTIMATORS: dict[str, type[TempoEstimator]] = {
    LibrosaTempo.method: LibrosaTempo,
    BeatThisTempo.method: BeatThisTempo,
}


def create_tempo_estimator(config: TempoConfig, device: str = "cpu") -> TempoEstimator:
    """config.method에 맞는 추정기. 모델은 load()에서 올림."""
    return ESTIMATORS[config.method](config, device)
