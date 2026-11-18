"""MDB Drums 드럼 트랙이 원곡 속 드럼과 같은지 확인.

MDB 23곡 중 12곡은 같은 녹음이 MUSDB18 train에도 들어 있음. MUSDB는 원곡이 스템 넷을 그대로 더한 것이라 MUSDB 드럼
스템은 원곡 속 드럼 그 자체임. 두 데이터의 원곡을 상호상관으로 맞춘 뒤 이득 하나만 곱해 비교하면, 원곡은 같은데
드럼 트랙이 다른지 알 수 있음. 마지막 열은 MDB 기준 반주(원곡 − MDB 드럼 트랙)를 MUSDB 드럼으로 설명할 수 있는
에너지 비율로, 0이면 MDB 기준 반주에 드럼이 안 남은 것.

  uv run python scripts/compare_mdb_musdb_stems.py --out docs/bench/separation-real-2026-10-29/mdb_musdb_stems.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
import soundfile as sf

from ssaplash_ai.bench.datasets.mdb import MDB_IN_MUSDB_TRAIN

OFFSET_SEARCH_SEC = 20


def to_mono(path: Path) -> tuple[np.ndarray, int]:
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return x.mean(axis=1), sr


def find_offset(a: np.ndarray, b: np.ndarray, n_max: int) -> int:
    """b를 몇 샘플 뒤로 밀어야 a와 맞는지. 앞 n_max 샘플의 상호상관 최댓값 위치."""
    n = min(len(a), len(b), n_max)
    cc = np.fft.irfft(np.fft.rfft(a[:n], 2 * n) * np.conj(np.fft.rfft(b[:n], 2 * n)))
    k = int(np.argmax(np.abs(cc)))
    return k if k < n else k - 2 * n


def shift(b: np.ndarray, offset: int) -> np.ndarray:
    """offset만큼 뒤로 밂(음수면 앞을 자름)."""
    if offset > 0:
        return np.concatenate([np.zeros(offset, dtype=b.dtype), b])
    return b[-offset:] if offset < 0 else b


def gain_fit(target: np.ndarray, ref: np.ndarray) -> tuple[float, float]:
    """ref에 이득 하나를 곱해 target에 맞춘 (SNR dB, 이득)."""
    n = min(len(target), len(ref))
    t, r = target[:n], ref[:n]
    g = float(np.dot(t, r) / (np.dot(r, r) + 1e-12))
    res = t - g * r
    return float(10 * np.log10(np.dot(t, t) / (np.dot(res, res) + 1e-12))), g


def musdb_name(mdb_song: str) -> str:
    """`MusicDelta_80sRock` → `Music Delta - 80s Rock` 비교용 키(소문자, 공백 없음)."""
    return mdb_song.removeprefix("MusicDelta_").lower()


def song_row(mdb_root: Path, musdb_track: Path, song: str) -> dict[str, object]:
    m_mix, sr = to_mono(mdb_root / "audio" / "full_mix" / f"{song}_MIX.wav")
    m_drm, _ = to_mono(mdb_root / "audio" / "drum_only" / f"{song}_Drum.wav")
    u_mix, _ = to_mono(musdb_track / "mixture.wav")
    u_drm, _ = to_mono(musdb_track / "drums.wav")
    off = find_offset(m_mix, u_mix, sr * OFFSET_SEARCH_SEC)
    u_mix, u_drm = shift(u_mix, off), shift(u_drm, off)
    n = min(len(m_mix), len(m_drm), len(u_mix), len(u_drm))
    m_mix, m_drm, u_mix, u_drm = m_mix[:n], m_drm[:n], u_mix[:n], u_drm[:n]
    mix_snr, _ = gain_fit(m_mix, u_mix)
    drum_snr, _ = gain_fit(u_drm, m_drm)
    accomp = m_mix - m_drm
    _, g = gain_fit(accomp, u_drm)
    left = g * u_drm
    return {
        "songId": song,
        "offsetSamples": off,
        "mixSnrDb": round(mix_snr, 2),
        "drumSnrDb": round(drum_snr, 2),
        "drumLeftInAccomp": round(float(np.dot(left, left) / (np.dot(accomp, accomp) + 1e-12)), 3),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--mdb-root", type=Path, default=Path("data/mdb_drums/MDB Drums"))
    p.add_argument("--musdb-train", type=Path, default=Path("data/musdb18hq/train"))
    p.add_argument("--out", type=Path, required=True, help="곡별 CSV")
    args = p.parse_args(argv)

    tracks = {
        p.name.removeprefix("Music Delta - ").lower().replace(" ", ""): p
        for p in args.musdb_train.iterdir()
        if p.name.startswith("Music Delta - ")
    }
    rows = [song_row(args.mdb_root, tracks[musdb_name(s)], s) for s in MDB_IN_MUSDB_TRAIN]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
