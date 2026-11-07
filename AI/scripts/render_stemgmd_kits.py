"""E-GMD 연주 MIDI를 StemGMD 단타 샘플(실제 어쿠스틱 키트 10종)로 렌더링한 학습용 사본 만들기
(ai_2_to_4.md 8.11 파인튜닝 가설 1·2, 11/07 실험).

- 곡마다 키트 10종 중 하나를 고정 시드로 고르고, MIDI 노트마다 그 악기의 세기 층(0~9) 샘플을 노트 세기에 맞춰 놓음
- GMD 피치 → 샘플: 36 킥, 38·40·37 스네어, 42·22·44 닫힌 하이햇, 46·26 열린 하이햇, 48·50 hi_tom, 45·47 mid_tom,
  43·58 low_tom, 49·55·57·52 crash_left, 51·59·53 ride. 정답 MIDI는 원래 파일을 그대로 복사 (E-GMD 로더 대응과 같음)
- `--pitch-shift`(가설 2): 곡마다 킥을 0~+12반음, 탐 세 개를 같이 −5~+2반음 무작위로 옮김(재생 속도를 바꾸는 방식이라
  길이도 같이 바뀜). 킥을 탐 높이까지 올려 킥과 탐 음높이 범위를 겹치게 함

  uv run python scripts/render_stemgmd_kits.py --list picks.csv --egmd data/e-gmd/e-gmd-v1.0.0 \
      --hits data/stemgmd/StemGMD_single_hits --out data/egmd_render/e-gmd-v1.0.0 [--pitch-shift]
"""

from __future__ import annotations

import argparse
import shutil
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

PITCH_PIECE = {
    36: "kick", 35: "kick",
    38: "snare", 40: "snare", 37: "snare",
    42: "hihat_closed", 22: "hihat_closed", 44: "hihat_closed",
    46: "hihat_open", 26: "hihat_open",
    48: "hi_tom", 50: "hi_tom",
    45: "mid_tom", 47: "mid_tom",
    43: "low_tom", 58: "low_tom",
    49: "crash_left", 55: "crash_left", 57: "crash_left", 52: "crash_left",
    51: "ride", 59: "ride", 53: "ride",
}  # fmt: skip
TOM_PIECES = ("hi_tom", "mid_tom", "low_tom")
SR = 44100


def layer(velocity: int) -> int:
    """MIDI 세기 → 단타 샘플 층 0~9 (StemGMD는 세기 30~127을 10단계로 녹음)"""
    return int(np.clip(round((velocity - 30) / (127 - 30) * 9), 0, 9))


def shift(sample: np.ndarray, semitones: float) -> np.ndarray:
    """재생 속도를 바꿔 음높이를 옮김 (반음 +면 높고 짧아짐)"""
    if abs(semitones) < 1e-6:
        return sample
    import soxr

    ratio = 2.0 ** (semitones / 12.0)
    return soxr.resample(sample.T, SR * ratio, SR).T.astype(np.float32)


def render(
    notes: list[tuple[float, int, int]], kit: dict, length: int, shifts: dict[str, float]
) -> np.ndarray:
    """(초, 피치, 세기) 노트 → (2, length) 소리. 피크가 0.99를 넘으면 줄임"""
    out = np.zeros((2, length), dtype=np.float32)
    cache: dict[tuple[str, int], np.ndarray] = {}
    for t, pitch, vel in notes:
        piece = PITCH_PIECE.get(int(pitch))
        if piece is None:
            continue
        key = (piece, layer(vel))
        if key not in cache:
            cache[key] = shift(kit[key], shifts.get(piece, 0.0))
        s = cache[key]
        a = int(round(t * SR))
        if a >= length:
            continue
        n = min(s.shape[1], length - a)
        out[:, a : a + n] += s[:, :n]
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.99:
        out *= np.float32(0.99 / peak)
    return out


def load_kit(folder: Path) -> dict[tuple[str, int], np.ndarray]:
    from ssaplash_ai.bench.datasets.base import read_audio

    pieces = {p for p in PITCH_PIECE.values()}
    return {(p, v): read_audio(folder / f"{p}-{v}.wav") for p in pieces for v in range(10)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", type=Path, required=True)
    ap.add_argument("--egmd", type=Path, required=True)
    ap.add_argument("--hits", type=Path, required=True, help="StemGMD_single_hits 폴더")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--pitch-shift", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets.base import audio_duration_sec, write_audio
    from ssaplash_ai.bench.datasets.gmd import midi_onsets

    kits_dir = sorted(p for p in args.hits.iterdir() if p.is_dir())
    kits = {k.name: load_kit(k) for k in kits_dir}
    print(f"[render] 키트 {len(kits)}종, 음높이 옮기기 {args.pitch_shift}", flush=True)
    picks = pd.read_csv(args.list)
    used = []
    for i, r in enumerate(picks.itertuples(), 1):
        rng = np.random.default_rng([args.seed, zlib.crc32(r.audio_filename.encode())])
        kit = kits_dir[int(rng.integers(0, len(kits_dir)))].name
        shifts: dict[str, float] = {}
        if args.pitch_shift:
            shifts["kick"] = float(rng.uniform(0.0, 12.0))
            tom = float(rng.uniform(-5.0, 2.0))
            shifts.update({p: tom for p in TOM_PIECES})
        used.append((r.audio_filename, kit, shifts.get("kick", 0.0), shifts.get("hi_tom", 0.0)))
        dst = args.out / r.audio_filename
        if dst.is_file():
            continue
        length = int(round(audio_duration_sec(args.egmd / r.audio_filename) * SR))
        notes = midi_onsets(args.egmd / r.midi_filename)
        audio = render(notes, kits[kit], length, shifts)
        tmp = dst.with_suffix(".part.wav")
        write_audio(tmp, audio)
        tmp.replace(dst)
        (args.out / r.midi_filename).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.egmd / r.midi_filename, args.out / r.midi_filename)
        if i % 100 == 0 or i == len(picks):
            print(f"[render] {i}/{len(picks)}", flush=True)
    picks.to_csv(args.out / "e-gmd-v1.0.0.csv", index=False, lineterminator="\n")
    pd.DataFrame(used, columns=["audio_filename", "kit", "kick_shift", "tom_shift"]).to_csv(
        args.out / "render_info.csv", index=False, lineterminator="\n"
    )
    print("[render] 끝", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
