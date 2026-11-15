"""예측 타격 시각을 일정하게 밀었을 때 점수가 오르는지 측정 (11/08 외부 피드백 확인용).

ADTOF + 드럼 킷 분리 규칙(`adtof_drumsep.yaml`)으로 낸 예측 타격 시각 전체에 같은 값(오프셋)을 더해 패드별 tp·fp·fn을 다시 셈.
허용 오차 ±50ms와 ±25ms 두 가지로 셈. 오프셋 0에서는 짝지어진 타격의 시각 차이(예측 − 정답)도 패드별로 저장함.
정답과 예측 사이에 일정한 시간 차이가 있으면 그만큼 밀었을 때 점수가 오르고, 시각 차이 중앙값이 0에서 벗어남.

  uv run python scripts/time_offset_eval.py --dataset configs/bench/datasets/enst_minus_one.yaml \
      --features data/rule_features --enst-c1-ride --out data/results/time-offset/enst_drums.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

SERVICE_RULES = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
SCORED = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
OFFSETS_MS = tuple(range(-30, 31, 5))
WINDOWS = {"w50": 0.05, "w25": 0.025}
_S: dict = {}


def _init(dataset_yaml: str, features: str, enst_c1_ride: bool) -> None:
    import yaml

    if enst_c1_ride:
        import ssaplash_ai.bench.datasets.enst as enst

        enst.ENST_LABEL_PAD["c1"] = "RIDE"
        enst.ENST_LABEL_PAD["c4"] = "RIDE"
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    _S.update(
        ds=load_dataset(DatasetConfig.from_yaml(dataset_yaml)),
        features=Path(features),
        rules=yaml.safe_load(SERVICE_RULES.read_text(encoding="utf-8"))["rules"],
    )


def song_rows(song_id: str) -> tuple[list[dict], list[dict]]:
    from ssaplash_ai.bench.analysis.rule_eval import predict_hits
    from ssaplash_ai.bench.analysis.rule_features import (
        feature_path,
        input_as_feature,
        load_features,
    )
    from ssaplash_ai.bench.metrics.hit_f1 import _relabel, match_by_label

    ds = _S["ds"]
    truth, _ = ds.hits_of(song_id)
    f = load_features(feature_path(_S["features"], ds.name, song_id))
    if "input" in f.stems:
        f.input_audio = f.stems.pop("input").astype(np.float16)
    else:
        f.input_audio = input_as_feature(ds.load(song_id).drums_true)
    pred = predict_hits(f, _S["rules"])
    t = _relabel(truth, "pads")
    rows, errs = [], []
    for off in OFFSETS_MS:
        p = _relabel(pred, "pads").copy()
        p["time_sec"] = p["time_sec"] + off / 1000.0
        for wname, w in WINDOWS.items():
            m = match_by_label(t, p, w)
            row = {"songId": song_id, "offset_ms": off, "window": wname}
            for pad in SCORED:
                c = m.get(pad)
                row[f"tp{pad}"], row[f"fp{pad}"], row[f"fn{pad}"] = (
                    (c.counts.tp, c.counts.fp, c.counts.fn) if c else (0, 0, 0)
                )
            rows.append(row)
            if off == 0 and wname == "w50":
                for pad, c in m.items():
                    errs += [
                        {"songId": song_id, "pad": pad, "err_ms": e * 1000} for e in c.errors_sec
                    ]
    return rows, errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument(
        "--enst-c1-ride", action="store_true", help="ENST c1·c4를 RIDE로 채점 (11/06 결정)"
    )
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    ap.add_argument(
        "--out", type=Path, required=True, help="곡·오프셋별 개수 csv. 시각 차이는 *_errors.csv"
    )
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    songs = load_dataset(DatasetConfig.from_yaml(args.dataset)).song_ids()
    print(f"[offset] 곡 {len(songs)}개 × 오프셋 {len(OFFSETS_MS)}개", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    err_path = args.out.with_name(args.out.stem + "_errors.csv")
    t0 = time.time()
    with (
        open(args.out, "w", newline="", encoding="utf-8") as fh,
        open(err_path, "w", newline="", encoding="utf-8") as eh,
        Pool(args.workers, _init, (args.dataset, args.features, args.enst_c1_ride)) as pool,
    ):
        w = None
        ew = csv.DictWriter(eh, fieldnames=["songId", "pad", "err_ms"], lineterminator="\n")
        ew.writeheader()
        for i, (rows, errs) in enumerate(pool.imap_unordered(song_rows, songs), 1):
            if w is None:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), lineterminator="\n")
                w.writeheader()
            w.writerows(rows)
            ew.writerows(errs)
            if i % 20 == 0 or i == len(songs):
                print(f"[offset] {i}/{len(songs)}곡 ({time.time() - t0:.0f}초)", flush=True)
    print(f"[offset] 저장 {args.out}, {err_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
