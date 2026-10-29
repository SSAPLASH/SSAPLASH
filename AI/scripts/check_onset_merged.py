"""정답 시각을 합쳐 타격 보존율을 다시 계산 (S15P31A307-166).

MDB·ENST 주석은 동시에 친 타격을 줄마다 따로 적어 같은 시각이 여러 번 나옴. 벤치마크의 온셋 검출기는 한 시각에
하나만 내므로 주석 그대로 채점하면 재현율이 막힘. 30ms 안에 붙은 정답 시각을 하나로 합친 뒤 정답 드럼·원곡·분리 드럼
세 입력에 벤치마크와 같은 검출기를 돌려 F1을 냄. 분리 드럼은 `ssaplash-bench run --save-wav`로 저장한 폴더에서 읽음.

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
from ssaplash_ai.bench.metrics.onset_preservation import detect_onsets, onset_scores

MERGE_GAP_SEC = 0.03


def merge_onsets(times: np.ndarray, gap_sec: float = MERGE_GAP_SEC) -> np.ndarray:
    """앞 시각과 gap_sec 안으로 붙은 시각은 버리고 첫 시각만 남김."""
    out: list[float] = []
    for t in np.sort(np.asarray(times, dtype=np.float64)):
        if not out or t - out[-1] > gap_sec:
            out.append(float(t))
    return np.array(out, dtype=np.float64)


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
