"""저장 특징(rule-features npz)의 채보 모델 타격 시각과 정답 사이에 일정한 시간 차가 있는지 확인.

E-GMD test에서 킥·스네어·하이햇 F1이 GMD test보다 크게 낮아, 정답과 오디오가 어긋난 것인지 모델이 못 잡는 것인지
가르기 위한 진단. 예측 시각을 -100~+100ms 옮겨 가며 5가지 F1을 재고, 가장 좋은 이동량과 그때의 F1을 데이터셋마다 찍는다.
이동량 0에서 최고이면 어긋남이 없고 모델 문제, 특정 이동량에서 크게 오르면 정답 시각 문제.

  uv run python scripts/check_hit_offset.py --dataset configs/bench/datasets/egmd_test_acoustic.yaml configs/bench/datasets/gmd_test.yaml --n-songs 20
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.analysis.rule_features import feature_path, load_features
from ssaplash_ai.bench.datasets import load_dataset
from ssaplash_ai.bench.datasets.pads import HITS_DTYPE, NO_VELOCITY
from ssaplash_ai.bench.metrics.hit_f1 import score_hits

# ADTOF 원래 라벨 → 예측 표 라벨
PITCH_LABEL = {35: "KICK", 38: "SNARE", 42: "HIHAT", 47: "tom", 49: "cymbal"}


def pred_hits(peaks: dict[int, np.ndarray], shift_sec: float) -> np.ndarray:
    rows = [
        (float(t) + shift_sec, PITCH_LABEL[p], NO_VELOCITY)
        for p, times in peaks.items()
        if p in PITCH_LABEL
        for t in times
    ]
    hits = np.array(rows, dtype=HITS_DTYPE) if rows else np.zeros(0, dtype=HITS_DTYPE)
    return hits[np.argsort(hits["time_sec"], kind="stable")]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--dataset", nargs="+", required=True)
    p.add_argument("--features", default="data/rule_features")
    p.add_argument("--n-songs", type=int, default=20, help="데이터셋마다 앞에서부터 이 수만큼")
    p.add_argument("--shifts-ms", default="-100:100:10", help="시작:끝:간격 (ms)")
    args = p.parse_args(argv)
    lo, hi, step = (int(v) for v in args.shifts_ms.split(":"))
    shifts = list(range(lo, hi + 1, step))

    for ds_yaml in args.dataset:
        ds = load_dataset(ds_yaml)
        ids = ds.song_ids()[: args.n_songs]
        totals: dict[int, dict[str, list[int]]] = {s: {} for s in shifts}
        n_used = 0
        for sid in ids:
            path = feature_path(Path(args.features), ds.name, sid)
            if not path.is_file():
                continue
            feats = load_features(path)
            found = ds.hits_of(sid)
            if found is None:
                continue
            hits_true = found[0]
            n_used += 1
            for s in shifts:
                scores = score_hits(hits_true, pred_hits(feats.peaks, s / 1000.0), "five")
                for label, c in scores.by_label.items():
                    acc = totals[s].setdefault(label, [0, 0, 0])
                    acc[0] += c.tp
                    acc[1] += c.fp
                    acc[2] += c.fn
        if not n_used:
            print(f"{ds.name}: 특징 파일을 못 찾음 ({args.features}/{ds.name})")
            continue
        print(f"== {ds.name}: 곡 {n_used}개")
        best = None
        for s in shifts:
            tp = sum(v[0] for v in totals[s].values())
            fp = sum(v[1] for v in totals[s].values())
            fn = sum(v[2] for v in totals[s].values())
            f1 = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 0.0
            per = {
                k: round(2 * v[0] / (2 * v[0] + v[1] + v[2]), 3)
                if (2 * v[0] + v[1] + v[2])
                else 0.0
                for k, v in sorted(totals[s].items())
            }
            if best is None or f1 > best[1]:
                best = (s, f1)
            if s % 20 == 0 or s == best[0]:
                print(f"  이동 {s:+4d}ms: f1 {f1:.3f} {per}")
        print(f"  최고 이동량 {best[0]:+d}ms (f1 {best[1]:.3f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
