"""원곡 읽기·트랙 쓰기 (설계 2장 audio_io, 4-1절 1·3번).

읽기: mp3·wav·flac → (채널 2, 샘플) float32, 44.1kHz. 디코딩·샘플레이트 변환·모노 복사는 벤치마크
`datasets/base.py`의 read_audio(soundfile + soxr)를 그대로 쓰고, 여기서는 입력 검사만 더함.
soundfile 0.14(libsndfile 1.2)가 mp3를 읽으므로 ffmpeg가 필요 없음(설계 U3).

검사 순서: 파일 열기 → 길이 상한(헤더만 읽고 디코딩 전에) → 샘플레이트 범위 → 디코딩 → 무음.
어느 하나라도 걸리면 ChartInputError, 모델은 돌지 않음(4-4절).

쓰기: flac 16비트(기본) 또는 wav PCM_16. ±1을 넘는 값은 잘라 저장. 실패하면 ChartOutputError.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from ssaplash_ai.bench.datasets.base import SAMPLE_RATE, read_audio
from ssaplash_ai.chart.config import OUTPUT_FORMATS
from ssaplash_ai.chart.errors import ChartInputError, ChartOutputError, summarize_exception

MIN_SAMPLE_RATE = 8000
MAX_SAMPLE_RATE = 192000
# 최대 진폭이 이보다 작으면 무음(-80dBFS)
SILENCE_PEAK = 1e-4
WRITE_SUBTYPE = "PCM_16"


@dataclass
class AudioInfo:
    """헤더만 읽은 정보. 디코딩 전 길이·샘플레이트 검사용."""

    sample_rate: int
    frames: int
    channels: int
    format: str

    @property
    def duration_sec(self) -> float:
        return self.frames / self.sample_rate if self.sample_rate else 0.0


def probe(path: str | Path) -> AudioInfo:
    """파일 헤더 읽기. 없거나 못 여는 파일은 ChartInputError."""
    path = Path(path)
    if not path.is_file():
        raise ChartInputError(f"입력 파일이 없음: {path.name}")
    try:
        info = sf.info(str(path))
    except Exception as e:  # LibsndfileError 등. 손상 파일·지원하지 않는 형식
        raise ChartInputError(
            f"입력 파일을 읽지 못함: {path.name} ({summarize_exception(e)})"
        ) from e
    return AudioInfo(
        sample_rate=int(info.samplerate),
        frames=int(info.frames),
        channels=int(info.channels),
        format=str(info.format),
    )


def read_audio_file(
    path: str | Path,
    sample_rate: int = SAMPLE_RATE,
    max_duration_sec: float | None = None,
) -> np.ndarray:
    """원곡 파일 → (2, 샘플) float32. 입력 검사에 걸리면 ChartInputError."""
    path = Path(path)
    info = probe(path)
    if info.frames <= 0:
        raise ChartInputError(f"입력 파일이 비어 있음: {path.name}")
    if max_duration_sec is not None and info.duration_sec > max_duration_sec:
        raise ChartInputError(
            f"입력이 너무 긺: {info.duration_sec:.1f}초 (상한 {max_duration_sec:.0f}초)"
        )
    if not MIN_SAMPLE_RATE <= info.sample_rate <= MAX_SAMPLE_RATE:
        raise ChartInputError(f"샘플레이트 이상: {info.sample_rate}Hz")
    try:
        audio = read_audio(path, sample_rate)
    except Exception as e:
        raise ChartInputError(
            f"입력 파일을 디코딩하지 못함: {path.name} ({summarize_exception(e)})"
        ) from e
    if audio.shape[1] == 0:
        raise ChartInputError(f"입력 파일이 비어 있음: {path.name}")
    if float(np.max(np.abs(audio))) < SILENCE_PEAK:
        raise ChartInputError(f"입력이 무음: {path.name}")
    return audio


def write_audio_file(
    path: str | Path, audio: np.ndarray, sample_rate: int, fmt: str = "flac"
) -> Path:
    """(채널, 샘플) 배열을 flac 16비트 또는 wav PCM_16으로 저장. 실패하면 ChartOutputError."""
    fmt = fmt.lower()
    if fmt not in OUTPUT_FORMATS:
        raise ChartOutputError(f"출력 형식은 {OUTPUT_FORMATS} 중 하나: {fmt!r}")
    path = Path(path)
    data = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(path), data.T, sample_rate, format=fmt.upper(), subtype=WRITE_SUBTYPE)
    except Exception as e:
        raise ChartOutputError(f"파일을 쓰지 못함: {path.name} ({summarize_exception(e)})") from e
    return path


def duration_ms(n_samples: int, sample_rate: int) -> int:
    """샘플 수 → 길이(ms, 반올림 정수)."""
    return int(round(n_samples * 1000 / sample_rate))
