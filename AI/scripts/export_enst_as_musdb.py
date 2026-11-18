"""ENST minus-one 곡을 MUSDB 폴더 모양(곡 폴더마다 mixture.wav·drums.wav)으로 내보냄.

MR 품질 비교는 정답 MR이 정확한 데이터가 필요해서, ENST를 이 스크립트로 한 번 내보내고 측정은 MUSDB 로더로 함.
mixture = 드럼 wet_mix + MR × 반주 게인, drums = wet_mix. 0dB를 넘을 수 있어 32비트 float wav로 저장.
곡 폴더 이름은 `drummer_1/107_...` 의 `/`를 `__`로 바꾼 것.

  # AI/ 폴더에서
  .venv/bin/python <이 파일> configs/bench/datasets/enst_minus_one.yaml ~/ssaplash/datasets/enst-gain1-musdb/test --accomp-gain 1.0
"""

from __future__ import annotations

import argparse
from pathlib import Path

import soundfile as sf

from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

SEP = "__"


def folder_name(song_id: str) -> str:
    return song_id.replace("/", SEP)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("dataset", type=Path, help="ENST 데이터셋 yaml (kind: enst)")
    p.add_argument("out", type=Path, help="곡 폴더를 만들 폴더. MUSDB yaml의 root/subset에 해당")
    p.add_argument(
        "--accomp-gain", type=float, default=1.0, help="MR에 곱할 값. 1.0이면 녹음 음량 그대로"
    )
    args = p.parse_args(argv)

    config = DatasetConfig.from_yaml(args.dataset)
    if not hasattr(config, "extra"):
        raise SystemExit(
            "이 코드에는 ENST 로더가 없음. bench/datasets/enst.py가 있는 코드에서 실행"
        )
    config.extra["accomp_gain"] = args.accomp_gain
    ds = load_dataset(config)
    n = 0
    for sid in ds.song_ids():
        d = args.out / folder_name(sid)
        if (d / "mixture.wav").is_file() and (d / "drums.wav").is_file():
            continue
        song = ds.load(sid)
        d.mkdir(parents=True, exist_ok=True)
        sf.write(str(d / "drums.wav"), song.drums_true.T, song.sample_rate, subtype="FLOAT")
        sf.write(str(d / "mixture.wav"), song.mixture.T, song.sample_rate, subtype="FLOAT")
        n += 1
    total = sum(1 for x in args.out.iterdir() if x.is_dir())
    print(f"새로 쓴 곡 {n}개, 폴더 안 곡 {total}개 → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
