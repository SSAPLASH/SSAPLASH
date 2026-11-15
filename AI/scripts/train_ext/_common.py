"""STRUM CRNN 학습 스크립트가 쓰는 데이터 읽기·저장 (11/11).

별도 가상환경에서 `python -I`로 돌므로 numpy·soundfile·torch만 씀. 곡 목록은 `export_manifest.py`가 만든 json.
- SegmentSet: 곡에서 임의 구간을 잘라 (파형, 프레임별 정답)을 냄. 반주를 작게 섞기·음량 바꾸기 포함
- save_acts / load_acts: 곡 하나의 프레임별 점수 저장 형식. acts_to_notes.py가 읽어 노트로 바꿈
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

PADS = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")


def load_meta(path: str | Path) -> dict:
    """곡 목록 json. 음원·정답 경로가 상대 경로면 목록 파일이 있는 폴더 기준으로 바꿈(서버에 올린 묶음)."""
    path = Path(path).resolve()
    meta = json.loads(path.read_text(encoding="utf-8"))
    for song in meta["songs"]:
        for key in ("drums", "accomp", "labels"):
            if song.get(key) and not Path(song[key]).is_absolute():
                song[key] = str(path.parent / song[key])
    return meta


def load_manifest(path: str | Path) -> list[dict]:
    return load_meta(path)["songs"]


def read_mono(path: str, start: int = 0, frames: int = -1, sample_rate: int = 44100) -> np.ndarray:
    """음원 일부를 모노 float32로 읽음. start·frames는 sample_rate 기준 샘플 수.

    파일의 표본화 주파수가 다르면 같은 시간 구간만 읽어 sample_rate로 바꿈.
    """
    import soundfile as sf

    with sf.SoundFile(path) as f:
        sr = f.samplerate
        if sr == sample_rate:
            f.seek(min(start, f.frames))
            return f.read(frames, dtype="float32", always_2d=True).mean(axis=1)
        f.seek(min(int(round(start * sr / sample_rate)), f.frames))
        n = -1 if frames < 0 else int(np.ceil(frames * sr / sample_rate))
        audio = f.read(n, dtype="float32", always_2d=True).mean(axis=1)
    from math import gcd

    from scipy.signal import resample_poly

    g = gcd(sample_rate, sr)
    out = resample_poly(audio, sample_rate // g, sr // g).astype(np.float32)
    return out if frames < 0 else out[:frames]


def frame_targets(
    times: np.ndarray,
    pads: np.ndarray,
    n_frames: int,
    fps: float,
    n_classes: int,
    pad_to_class: dict[int, int],
    radiation: int = 0,
    floor: bool = False,
) -> np.ndarray:
    """노트 → (프레임, 분류) 0/1. radiation만큼 앞뒤 프레임도 1."""
    target = np.zeros((n_frames, n_classes), dtype=np.float32)
    pos = times * fps
    frames = np.floor(pos).astype(int) if floor else np.rint(pos).astype(int)
    for f, p in zip(frames.tolist(), pads.tolist(), strict=True):
        c = pad_to_class.get(int(p))
        if c is None:
            continue
        lo, hi = max(0, f - radiation), min(n_frames, f + radiation + 1)
        if lo < hi:
            target[lo:hi, c] = 1.0
    return target


class SegmentSet:
    """곡 목록에서 임의 구간을 뽑는 데이터. torch Dataset처럼 쓰되 색인은 무시하고 매번 새로 뽑음."""

    def __init__(
        self,
        manifests: list[tuple[str, float]],
        seconds: float,
        sample_rate: int = 44100,
        accomp_prob: float = 0.3,
        accomp_gain: tuple[float, float] = (0.05, 0.3),
        gain_db: tuple[float, float] = (-6.0, 6.0),
        length: int = 1000,
        seed: int = 0,
    ):
        self.groups = []
        for path, weight in manifests:
            songs = [s for s in load_manifest(path) if s["duration"] > seconds + 1.0]
            self.groups.append((songs, float(weight)))
        self.weights = np.array([w for _, w in self.groups], dtype=np.float64)
        self.weights /= self.weights.sum()
        self.seconds, self.sr = seconds, sample_rate
        self.accomp_prob, self.accomp_gain, self.gain_db = accomp_prob, accomp_gain, gain_db
        self.length, self.seed = length, seed
        self._labels: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self._rng: np.random.Generator | None = None

    def __len__(self) -> int:
        return self.length

    def labels(self, song: dict) -> tuple[np.ndarray, np.ndarray]:
        key = song["labels"]
        if key not in self._labels:
            z = np.load(key)
            self._labels[key] = (z["time"], z["pad"])
        return self._labels[key]

    def draw(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(파형, 구간 안 노트 시각(구간 시작 기준 초), 패드 번호)."""
        if self._rng is None:
            import os

            self._rng = np.random.default_rng([self.seed, os.getpid()])
        rng = self._rng
        songs, _ = self.groups[int(rng.choice(len(self.groups), p=self.weights))]
        song = songs[int(rng.integers(len(songs)))]
        n = int(self.seconds * self.sr)
        total = int(song["duration"] * self.sr)
        start = int(rng.integers(0, max(total - n, 1)))
        audio = read_mono(song["drums"], start, n, self.sr)
        if len(audio) < n:
            audio = np.pad(audio, (0, n - len(audio)))
        if song.get("accomp") and rng.random() < self.accomp_prob:
            other = read_mono(song["accomp"], start, n, self.sr)
            if len(other) < n:
                other = np.pad(other, (0, n - len(other)))
            audio = audio + float(rng.uniform(*self.accomp_gain)) * other
        audio = audio * float(10 ** (rng.uniform(*self.gain_db) / 20))
        times, pads = self.labels(song)
        t0 = start / self.sr
        keep = (times >= t0) & (times < t0 + self.seconds)
        return audio.astype(np.float32), times[keep] - t0, pads[keep]


def save_acts(
    path: Path,
    fps: float,
    names: list[str],
    acts: dict[str, np.ndarray],
    seconds: float = 0.0,
    checkpoint: str = "",
) -> None:
    """프레임별 점수 저장. acts 값은 (프레임, len(names)) 0~1. seconds는 채보에 걸린 시간."""
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        fps=float(fps),
        names=np.array(names, dtype="U16"),
        seconds=float(seconds),
        checkpoint=str(checkpoint),
        **{f"acts_{k}": v.astype(np.float16) for k, v in acts.items()},
    )


def acts_path(root: Path, tag: str, manifest: str, song_id: str) -> Path:
    return root / tag / manifest / f"{song_id.replace('/', '__')}.npz"
