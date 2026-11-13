"""정답 드럼·원곡·분리 드럼 세 입력의 타격 보존율 비교.

벤치마크는 분리 드럼 하나만 채점함. 이 스크립트는 같은 검출기·같은 정답으로 정답 드럼과 분리 안 한 원곡도 채점해
분리 드럼 점수를 어디에 비춰 읽을지 기준값을 냄. 정답은 벤치마크처럼 30ms 안 시각을 합친 것(merge_onsets)과
주석 그대로인 것(Raw 열) 둘 다 냄. 분리 드럼은 `ssaplash-bench run --save-wav`로 저장한 폴더에서 읽음.

  uv run python scripts/check_onset_merged.py configs/bench/datasets/mdb_drums_unseen.yaml \
      --separated data/results/sep-quality-mdbu/separated/bs_roformer_sw \
      --out docs/bench/separation-real-2026-10-29/onset_merged_mdb_unseen.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets import load_dataset
from ssaplash_ai.bench.datasets.base import read_audio
from ssaplash_ai.bench.metrics.onset_preservation import detect_onsets, merge_onsets, onset_scores


def song_row(song, separated_dir: Path | None) -> dict[str, object]:
    """곡 하나의 F1들. 주석 그대로(Raw)와 합친 정답 두 가지."""
    raw = song.onsets_true
    merged = merge_onsets(raw)
    sr = song.sample_rate
    drums = detect_onsets(song.drums_true, sr)
    mixture = detect_onsets(song.mixture, sr)
    row: dict[str, object] = {
        "songId": song.song_id,
        "nAnnotation": len(raw),
        "nMerged": len(merged),
        "f1DrumsRaw": onset_scores(raw, drums)[0],
        "f1Drums": onset_scores(merged, drums)[0],
        "f1Mixture": onset_scores(merged, mixture)[0],
    }
    if separated_dir is not None:
        sep = detect_onsets(read_audio(separated_dir / song.song_id / "drums.wav"), sr)
        row["f1SeparatedRaw"] = onset_scores(raw, sep)[0]
        row["f1Separated"] = onset_scores(merged, sep)[0]
    return row


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("dataset", type=Path, help="타격 정답이 있는 데이터셋 yaml")
    p.add_argument(
        "--separated", type=Path, default=None, help="<곡>/drums.wav 가 있는 분리 결과 폴더"
    )
    p.add_argument("--out", type=Path, required=True, help="곡별 CSV")
    args = p.parse_args(argv)

    ds = load_dataset(args.dataset)
    rows = [song_row(ds.load(sid), args.separated) for sid in ds.song_ids()]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    keys = [k for k in rows[0] if k.startswith("f1")]
    medians = {k: round(float(np.median([r[k] for r in rows])), 3) for k in keys}
    print(f"{ds.name} {len(rows)}곡 중앙값 {medians} → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
