"""원곡 읽기·트랙 쓰기 (설계 2장 audio_io, 4-1절 1·3번).

읽기: mp3·wav·flac·opus·m4a → (채널 2, 샘플) float32, 44.1kHz. 디코딩·샘플레이트 변환·모노 복사는 벤치마크
`datasets/base.py`의 read_audio(soundfile + soxr)를 그대로 쓰고, 여기서는 입력 검사만 더함.
soundfile 0.14(libsndfile 1.2)가 mp3·Ogg Opus를 읽으므로 ffmpeg가 필요 없음(설계 U3).
libsndfile이 못 여는 파일(m4a의 AAC·ALAC)만 PyAV로 디코딩함. 확장자가 아니라 soundfile이 열었는지로 고름.
PyAV는 FFmpeg 라이브러리를 휠에 묶어 와서 시스템 ffmpeg가 필요 없음. AAC 앞쪽 인코더 지연은 FFmpeg가 잘라 주고,
마지막 프레임의 채움 샘플은 헤더 길이로 자름(_read_pyav).

검사 순서: 파일 열기 → 길이 상한(헤더만 읽고 디코딩 전에) → 샘플레이트 범위 → 디코딩 → 무음.
어느 하나라도 걸리면 ChartInputError, 모델은 돌지 않음(4-4절).

쓰기: flac 16비트(기본) 또는 wav PCM_16. ±1을 넘는 값은 잘라 저장. 실패하면 ChartOutputError.

길이 맞추기: BE가 준 원곡 길이(ms)로 샘플 수를 정하고(samples_for_ms) 끝에서만 자르거나 채움(fit_length).
워커 설계 3-7절. BE는 분리 결과 flac의 길이를 ms로 올림해 원곡 길이와 정확히 같은지 검사함.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import av
import numpy as np
import soundfile as sf
import soxr

from ssaplash_ai.bench.datasets.base import SAMPLE_RATE, read_audio
from ssaplash_ai.chart.config import OUTPUT_FORMATS
from ssaplash_ai.chart.errors import ChartInputError, ChartOutputError, summarize_exception

MIN_SAMPLE_RATE = 8000
MAX_SAMPLE_RATE = 192000
# 최대 진폭이 이보다 작으면 무음(-80dBFS)
SILENCE_PEAK = 1e-4
WRITE_SUBTYPE = "PCM_16"
DECODER_SOUNDFILE = "soundfile"
DECODER_PYAV = "pyav"


@dataclass
class AudioInfo:
    """헤더만 읽은 정보. 디코딩 전 길이·샘플레이트 검사용. decoder는 파일을 연 쪽."""

    sample_rate: int
    frames: int
    channels: int
    format: str
    decoder: str = DECODER_SOUNDFILE

    @property
    def duration_sec(self) -> float:
        return self.frames / self.sample_rate if self.sample_rate else 0.0


def probe(path: str | Path) -> AudioInfo:
    """파일 헤더 읽기. soundfile이 못 열면 PyAV로. 없거나 둘 다 못 여는 파일은 ChartInputError."""
    path = Path(path)
    if not path.is_file():
        raise ChartInputError(f"입력 파일이 없음: {path.name}")
    try:
        info = sf.info(str(path))
    except Exception:  # LibsndfileError 등. m4a처럼 libsndfile이 모르는 형식이면 PyAV로
        return _probe_pyav(path)
    return AudioInfo(
        sample_rate=int(info.samplerate),
        frames=int(info.frames),
        channels=int(info.channels),
        format=str(info.format),
    )


def _probe_pyav(path: Path) -> AudioInfo:
    """PyAV로 첫 오디오 스트림의 헤더 읽기. 길이는 스트림 길이, 없으면 컨테이너 길이."""
    try:
        with av.open(str(path)) as container:
            if not container.streams.audio:
                raise ValueError("오디오 스트림 없음")
            stream = container.streams.audio[0]
            ctx = stream.codec_context
            sample_rate = int(ctx.sample_rate or 0)
            if stream.duration is not None and stream.time_base is not None:
                seconds = float(stream.duration * stream.time_base)
            elif container.duration is not None:
                seconds = container.duration / av.time_base
            else:
                seconds = 0.0
            return AudioInfo(
                sample_rate=sample_rate,
                frames=int(round(seconds * sample_rate)),
                channels=int(ctx.layout.nb_channels),
                format=f"{container.format.name}/{ctx.name}",
                decoder=DECODER_PYAV,
            )
    except Exception as e:  # FFmpegError 등. 손상 파일·지원하지 않는 형식
        raise ChartInputError(
            f"입력 파일을 읽지 못함: {path.name} ({summarize_exception(e)})"
        ) from e


def _read_pyav(path: Path, sample_rate: int, frames: int) -> np.ndarray:
    """PyAV로 디코딩 → (2, 샘플) float32. 변환·채널 정리는 datasets/base.py read_audio와 같음.

    frames는 probe가 읽은 원본 샘플레이트 기준 길이. AAC는 마지막 프레임을 1024샘플로 채워 저장하는데
    PyAV 18(Python 3.11에서 쓸 수 있는 마지막 판)은 이 채움을 잘라 주지 않아, 디코딩 결과가 더 길면 frames에서 자름.
    앞쪽 인코더 지연은 FFmpeg가 m4a의 edit list를 읽어 이미 건너뜀.
    """
    chunks: list[np.ndarray] = []
    with av.open(str(path)) as container:
        stream = container.streams.audio[0]
        # 디코더 출력 형식(fltp·s16p·s16 등)을 float32 평면 배열 (채널, 샘플)로 통일. 샘플레이트·채널은 그대로
        resampler = av.AudioResampler(format="fltp")
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray())
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray())
        sr = int(stream.codec_context.sample_rate)
    if not chunks:
        return np.zeros((2, 0), dtype=np.float32)
    data = np.concatenate(chunks, axis=1).T.astype(np.float32)  # (샘플, 채널)
    if 0 < frames < data.shape[0]:
        data = data[:frames]
    if sr != sample_rate:
        data = soxr.resample(data, sr, sample_rate).astype(np.float32)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    return np.ascontiguousarray(data.T, dtype=np.float32)


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
        if info.decoder == DECODER_PYAV:
            audio = _read_pyav(path, sample_rate, info.frames)
        else:
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


def samples_for_ms(duration_ms: int, sample_rate: int) -> int:
    """길이(ms) → 샘플 수. 정수 연산 내림 (BE 회신 2: N = durationMs × 44100 // 1000).

    이 N으로 만든 파일의 길이를 ms로 올림하면 항상 duration_ms와 같음 (워커 설계 인수 조건 9).
    """
    if duration_ms <= 0:
        raise ValueError(f"길이는 양수: {duration_ms} ms")
    return duration_ms * sample_rate // 1000


def fit_length(audio: np.ndarray, n_samples: int) -> np.ndarray:
    """(채널, 샘플) 배열을 끝에서만 잘라 내거나 끝에 0을 채워 n_samples로 맞춤. 시작점은 그대로."""
    if n_samples <= 0:
        raise ValueError(f"샘플 수는 양수: {n_samples}")
    length = audio.shape[1]
    if length == n_samples:
        return audio
    if length > n_samples:
        return audio[:, :n_samples]
    pad = np.zeros((audio.shape[0], n_samples - length), dtype=audio.dtype)
    return np.concatenate([audio, pad], axis=1)
