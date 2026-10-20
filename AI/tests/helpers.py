"""테스트 공용 도구. 짧은 가짜 wav와 가짜 MUSDB 곡 생성.

pytest가 tests/ 를 sys.path에 넣으므로 `from helpers import ...`로 사용.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100


def make_tone(seconds: float, sr: int = SR, freq: float = 440.0, channels: int = 2) -> np.ndarray:
    """(채널, 샘플) float32 사인파. 진폭 0.25."""
    t = np.arange(int(seconds * sr)) / sr
    mono = 0.25 * np.sin(2 * np.pi * freq * t).astype(np.float32)
    return np.stack([mono] * channels)


def write_wav(path: Path, audio: np.ndarray, sr: int = SR) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio.T, sr, subtype="PCM_16")


def make_musdb_song(song_dir: Path, seconds: float = 1.0, sr: int = SR) -> dict[str, np.ndarray]:
    """mixture = drums + bass + other + vocals 관계가 정확히 맞는 가짜 곡."""
    stems = {
        "drums": make_tone(seconds, sr, 220.0),
        "bass": make_tone(seconds, sr, 110.0) * 0.5,
        "other": make_tone(seconds, sr, 660.0) * 0.5,
        "vocals": make_tone(seconds, sr, 880.0) * 0.5,
    }
    stems["mixture"] = sum(stems.values())
    for name, audio in stems.items():
        write_wav(song_dir / f"{name}.wav", audio, sr)
    return stems


HITS = [0.2, 0.5, 0.9, 1.3, 1.8]


def make_hits(seconds: float = 2.2, times: list[float] | None = None) -> np.ndarray:
    """타격마다 10ms 안에 솟았다가 80ms 동안 꺼지는 잡음 버스트. (2, 샘플)."""
    rng = np.random.default_rng(1)
    n = int(seconds * SR)
    mono = np.zeros(n, dtype=np.float32)
    burst_len = int(0.08 * SR)
    t = np.arange(burst_len) / SR
    env = np.minimum(t / 0.004, 1.0) * np.exp(-t / 0.02)
    for hit in times or HITS:
        start = int(hit * SR)
        burst = env * rng.standard_normal(burst_len)
        mono[start : start + burst_len] += burst.astype(np.float32)
    mono *= 0.5 / np.max(np.abs(mono))
    return np.stack([mono, mono])
