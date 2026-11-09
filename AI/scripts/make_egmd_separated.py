"""E-GMD 드럼에 MUSDB18-HQ train 반주를 섞고 서비스 분리 모델로 다시 드럼만 뽑은 학습용 사본 만들기
(ai_2_to_4.md 8.11 파인튜닝 가설 3, 11/07 실험).

- 곡마다 MUSDB train 100곡 중 하나를 고정 시드로 골라, 반주(베이스+기타 등+보컬)의 무작위 구간을 드럼 길이만큼 자름
- 반주 크기는 드럼 RMS 대비 0.5~2배 사이 무작위 (곡마다 고정 시드)
- 섞은 소리를 BS Roformer SW(`configs/bench/models/msst/bs_roformer_sw.yaml`, 서비스와 같음)로 분리한 드럼을
  원래와 같은 상대 경로의 wav로 저장. MIDI와 목록 csv는 그대로 복사해 E-GMD 로더가 그대로 읽게 함

  uv run python scripts/make_egmd_separated.py --list picks.csv --egmd data/e-gmd/e-gmd-v1.0.0 \
      --musdb data/musdb18hq/train --out data/egmd_sep/e-gmd-v1.0.0
"""

from __future__ import annotations

import argparse
import shutil
import time
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

SEP_YAML = Path("configs/bench/models/msst/bs_roformer_sw.yaml")
ACCOMP_STEMS = ("bass", "other", "vocals")
RATIO_RANGE = (0.5, 2.0)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if x.size else 0.0


def mix_with_accomp(drums: np.ndarray, accomp: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """드럼 (2, n)에 반주의 무작위 구간을 RMS 비율 0.5~2배로 더함. 반주가 짧으면 반복"""
    n = drums.shape[1]
    if accomp.shape[1] < n:
        accomp = np.tile(accomp, (1, n // accomp.shape[1] + 1))
    start = int(rng.integers(0, accomp.shape[1] - n + 1))
    seg = accomp[:, start : start + n]
    d, a = rms(drums), rms(seg)
    if d == 0 or a == 0:
        return drums.copy()
    ratio = float(rng.uniform(*RATIO_RANGE))
    return (drums + seg * (ratio * d / a)).astype(np.float32)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--list",
        type=Path,
        required=True,
        help="E-GMD 목록 csv에서 고른 줄 (audio_filename·midi_filename)",
    )
    ap.add_argument("--egmd", type=Path, required=True)
    ap.add_argument("--musdb", type=Path, required=True, help="MUSDB18-HQ train 폴더")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets.base import read_audio, write_audio
    from ssaplash_ai.bench.separators import SeparatorConfig, create_separator

    picks = pd.read_csv(args.list)
    musdb = sorted(p for p in args.musdb.iterdir() if p.is_dir())
    sep = create_separator(SeparatorConfig.from_yaml(SEP_YAML), "cuda")
    print(
        f"[egmd-sep] 분리 모델 로드 {sep.load():.1f}s, 곡 {len(picks)}개, 반주 후보 {len(musdb)}곡",
        flush=True,
    )
    args.out.mkdir(parents=True, exist_ok=True)
    accomp_cache: dict[Path, np.ndarray] = {}
    t0, done, skipped = time.time(), 0, 0
    for i, r in enumerate(picks.itertuples(), 1):
        dst = args.out / r.audio_filename
        midi_dst = args.out / r.midi_filename
        if dst.is_file() and midi_dst.is_file():
            skipped += 1
            continue
        # 곡마다 같은 결과가 나오게 곡 이름으로 시드를 정함
        rng = np.random.default_rng([args.seed, zlib.crc32(r.audio_filename.encode())])
        song = musdb[int(rng.integers(0, len(musdb)))]
        if song not in accomp_cache:
            if len(accomp_cache) > 20:
                accomp_cache.clear()
            accomp_cache[song] = sum(read_audio(song / f"{s}.wav") for s in ACCOMP_STEMS)
        drums = read_audio(args.egmd / r.audio_filename)
        mix = mix_with_accomp(drums, accomp_cache[song], rng)
        out = sep.separate(mix, 44100).drums
        tmp = dst.with_suffix(".part.wav")
        write_audio(tmp, out)
        tmp.replace(dst)
        midi_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.egmd / r.midi_filename, midi_dst)
        done += 1
        if i % 50 == 0 or i == len(picks):
            print(f"[egmd-sep] {i}/{len(picks)} ({time.time() - t0:.0f}초)", flush=True)
    picks.to_csv(args.out / "e-gmd-v1.0.0.csv", index=False, lineterminator="\n")
    print(f"[egmd-sep] 저장 {done}개, 건너뜀 {skipped}개", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
