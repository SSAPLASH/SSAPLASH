"""ADTOF + 드럼 킷 분리 규칙 예측의 틀린 타격·놓친 타격을 종류별로 나눔 (11/08).

곡마다 `adtof_drumsep.yaml` 규칙으로 예측하고 패드별로 ±50ms 짝을 지은 뒤, 남은 것을 아래처럼 나눔.
- 헛친 타격(fp)
  - 이름 혼동: 50ms 안에 다른 패드의 놓친 정답이 있음 (짝은 하나씩만 씀)
  - 같은 패드 중복: 100ms 안에 같은 패드의 맞힌 예측이 있음
  - 다른 타격 자리: 50ms 안에 다른 패드 정답이 있지만 그 정답은 이미 맞힘
  - 빈자리: 50ms 안에 정답 타격이 하나도 없음
- 놓친 타격(fn)
  - 이름 혼동: 위에서 짝지은 것
  - 동시 타격 속: 30ms 안에 다른 패드 정답이 있음
  - 혼자: 그 외
출력 csv 한 줄 = (곡, 패드, 종류, 개수). 이름 혼동은 *_confusion.csv에 (예측 패드, 정답 패드, 개수).

  uv run python scripts/hit_error_breakdown.py --dataset configs/bench/datasets/enst_minus_one.yaml \
      --features data/rule_features --enst-c1-ride --out data/results/postproc/err_enst_drums.csv
"""

from __future__ import annotations

import argparse
import csv
import os
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

import numpy as np

SERVICE_RULES = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
WINDOW = 0.05
DUP_WINDOW = 0.10
SIMUL_WINDOW = 0.03
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


def predict(song_id: str) -> tuple[np.ndarray, np.ndarray]:
    """(정답, 예측) 타격 표. 페달 하이햇은 하이햇으로 합침."""
    from ssaplash_ai.bench.analysis.rule_eval import predict_hits
    from ssaplash_ai.bench.analysis.rule_features import (
        feature_path,
        input_as_feature,
        load_features,
    )
    from ssaplash_ai.bench.metrics.hit_f1 import _relabel

    ds = _S["ds"]
    truth, _ = ds.hits_of(song_id)
    f = load_features(feature_path(_S["features"], ds.name, song_id))
    if "input" in f.stems:
        f.input_audio = f.stems.pop("input").astype(np.float16)
    else:
        f.input_audio = input_as_feature(ds.load(song_id).drums_true)
    return _relabel(truth, "pads"), _relabel(predict_hits(f, _S["rules"]), "pads")


def classify(truth: np.ndarray, pred: np.ndarray) -> tuple[Counter, Counter]:
    """(패드, 종류) 개수와 (예측 패드, 정답 패드) 이름 혼동 개수."""
    import mir_eval

    t_matched = np.zeros(len(truth), bool)
    p_matched = np.zeros(len(pred), bool)
    for pad in set(truth["pad"]) | set(pred["pad"]):
        ti = np.flatnonzero(truth["pad"] == pad)
        pi = np.flatnonzero(pred["pad"] == pad)
        if len(ti) and len(pi):
            for a, b in mir_eval.util.match_events(
                truth["time_sec"][ti], pred["time_sec"][pi], WINDOW
            ):
                t_matched[ti[a]] = True
                p_matched[pi[b]] = True
    counts: Counter = Counter()
    conf: Counter = Counter()
    for i in np.flatnonzero(t_matched):
        counts[(truth["pad"][i], "tp")] += 1
    t_used = t_matched.copy()
    tt, pt = truth["time_sec"], pred["time_sec"]
    for j in np.flatnonzero(~p_matched):
        pad = pred["pad"][j]
        near = np.flatnonzero((np.abs(tt - pt[j]) <= WINDOW) & ~t_used & (truth["pad"] != pad))
        if len(near):
            k = near[np.argmin(np.abs(tt[near] - pt[j]))]
            t_used[k] = True
            counts[(pad, "fp_이름혼동")] += 1
            counts[(truth["pad"][k], "fn_이름혼동")] += 1
            conf[(pad, truth["pad"][k])] += 1
            continue
        same = (pred["pad"] == pad) & p_matched & (np.abs(pt - pt[j]) <= DUP_WINDOW)
        if same.any():
            counts[(pad, "fp_같은패드중복")] += 1
        elif (np.abs(tt - pt[j]) <= WINDOW).any():
            counts[(pad, "fp_다른타격자리")] += 1
        else:
            counts[(pad, "fp_빈자리")] += 1
    for i in np.flatnonzero(~t_used):
        others = (truth["pad"] != truth["pad"][i]) & (np.abs(tt - tt[i]) <= SIMUL_WINDOW)
        counts[(truth["pad"][i], "fn_동시타격속" if others.any() else "fn_혼자")] += 1
    return counts, conf


def song_rows(song_id: str) -> tuple[list[dict], list[dict]]:
    truth, pred = predict(song_id)
    counts, conf = classify(truth, pred)
    rows = [
        {"songId": song_id, "pad": p, "kind": k, "n": n} for (p, k), n in sorted(counts.items())
    ]
    crows = [
        {"songId": song_id, "pred": a, "truth": b, "n": n} for (a, b), n in sorted(conf.items())
    ]
    return rows, crows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument(
        "--enst-c1-ride", action="store_true", help="ENST c1·c4를 RIDE로 채점 (11/06 결정)"
    )
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    songs = load_dataset(DatasetConfig.from_yaml(args.dataset)).song_ids()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    cpath = args.out.with_name(args.out.stem + "_confusion.csv")
    with (
        open(args.out, "w", newline="", encoding="utf-8") as fh,
        open(cpath, "w", newline="", encoding="utf-8") as ch,
        Pool(args.workers, _init, (args.dataset, args.features, args.enst_c1_ride)) as pool,
    ):
        w = csv.DictWriter(fh, fieldnames=["songId", "pad", "kind", "n"], lineterminator="\n")
        cw = csv.DictWriter(ch, fieldnames=["songId", "pred", "truth", "n"], lineterminator="\n")
        w.writeheader()
        cw.writeheader()
        for rows, crows in pool.imap_unordered(song_rows, songs):
            w.writerows(rows)
            cw.writerows(crows)
    print(f"[err] 곡 {len(songs)}개 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
