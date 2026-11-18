"""같은 키트 E-GMD 곡 두 개를 겹쳐 동시 타격이 많은 학습용 사본 만들기 (ai_2_to_4.md 8.11 파인튜닝 가설 4, 11/07 실험).

- 목록의 곡마다 같은 키트의 다른 곡 하나를 고정 시드로 골라, 0.5~1배 크기로 무작위 위치에 더함. 첫 곡 길이를 넘는 부분은 자름
- MIDI는 두 곡의 노트를 합침(둘째 곡은 더한 위치만큼 시각을 옮김). 피크가 0.99를 넘으면 소리 전체를 줄임
- 원래 곡과 같은 상대 경로에 wav·midi를 쓰고 목록 csv를 복사해 E-GMD 로더가 그대로 읽게 함

  uv run python scripts/make_egmd_overlay.py --list picks.csv --egmd data/e-gmd/e-gmd-v1.0.0 \
      --out data/egmd_overlay/e-gmd-v1.0.0
"""

from __future__ import annotations

import argparse
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

GAIN_RANGE = (0.5, 1.0)


def overlay(a: np.ndarray, b: np.ndarray, start: int, gain: float) -> np.ndarray:
    """a (2, n)에 b를 start 샘플부터 gain배로 더함. a 길이 밖은 자름"""
    out = a.astype(np.float32).copy()
    n = min(b.shape[1], a.shape[1] - start)
    if n > 0:
        out[:, start : start + n] += np.float32(gain) * b[:, :n]
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.99:
        out *= np.float32(0.99 / peak)
    return out


def merge_midi(path_a: Path, path_b: Path, shift_sec: float, end_sec: float, out: Path) -> int:
    """두 MIDI의 드럼 노트를 합쳐 저장. b는 shift_sec만큼 뒤로, end_sec 넘는 노트는 뺌. 합친 노트 수"""
    import pretty_midi

    a = pretty_midi.PrettyMIDI(str(path_a))
    b = pretty_midi.PrettyMIDI(str(path_b))
    inst = pretty_midi.Instrument(program=0, is_drum=True)
    for ins in a.instruments:
        inst.notes.extend(ins.notes)
    for ins in b.instruments:
        for nt in ins.notes:
            s = nt.start + shift_sec
            if s < end_sec:
                inst.notes.append(
                    pretty_midi.Note(nt.velocity, nt.pitch, s, min(nt.end + shift_sec, end_sec))
                )
    inst.notes.sort(key=lambda x: x.start)
    pm = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    pm.instruments.append(inst)
    out.parent.mkdir(parents=True, exist_ok=True)
    pm.write(str(out))
    return len(inst.notes)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", type=Path, required=True)
    ap.add_argument("--egmd", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets.base import read_audio, write_audio

    picks = pd.read_csv(args.list)
    for i, r in enumerate(picks.itertuples(), 1):
        dst = args.out / r.audio_filename
        if dst.is_file() and (args.out / r.midi_filename).is_file():
            continue
        rng = np.random.default_rng([args.seed, zlib.crc32(r.audio_filename.encode())])
        same = picks[(picks.kit_name == r.kit_name) & (picks.audio_filename != r.audio_filename)]
        o = same.iloc[int(rng.integers(0, len(same)))]
        a = read_audio(args.egmd / r.audio_filename)
        b = read_audio(args.egmd / o.audio_filename)
        start = int(rng.integers(0, max(1, a.shape[1] - min(a.shape[1], b.shape[1]) + 1)))
        mix = overlay(a, b, start, float(rng.uniform(*GAIN_RANGE)))
        tmp = dst.with_suffix(".part.wav")
        write_audio(tmp, mix)
        tmp.replace(dst)
        merge_midi(
            args.egmd / r.midi_filename,
            args.egmd / o.midi_filename,
            start / 44100,
            a.shape[1] / 44100,
            args.out / r.midi_filename,
        )
        if i % 100 == 0 or i == len(picks):
            print(f"[egmd-overlay] {i}/{len(picks)}", flush=True)
    picks.to_csv(args.out / "e-gmd-v1.0.0.csv", index=False, lineterminator="\n")
    print("[egmd-overlay] 끝", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
