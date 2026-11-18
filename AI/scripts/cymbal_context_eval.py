"""크래시·라이드를 앞뒤 문맥으로 고치는 후처리 후보 채점 (ai_2_to_4.md 8.11 후처리 후보 3, 11/07 실험).

ADTOF + 드럼 킷 분리 규칙(11/07 당시 서비스 규칙. crash·ride 트랙 에너지 비교, crash 0.7배)으로 낸 예측에서 심벌 타격 이름만 문맥으로 고침.
- run: 앞과 뒤 모두 w초 안에 다른 심벌 타격이 있으면(이어 치는 흐름 안) 라이드
- isolated: 앞뒤 w초 안에 다른 심벌이 없고 30ms 안에 킥이 있으면 크래시
- both: 둘 다
- hold: 크래시로 낸 타격 뒤 h초 안의 심벌은 라이드 (Riley·Dixon 2024의 크래시 뒤 재판정 막기와 같은 방향)
곡마다 특징을 읽어 후보 전부를 채점하고 곡별 크래시·라이드·8패드 tp/fp/fn을 csv로 씀. 규칙 값은 E-GMD로 고르고 ENST는 한 번만.

  uv run python scripts/cymbal_context_eval.py --dataset configs/bench/datasets/egmd_test_acoustic.yaml \
      --features data/rule_features --out data/results/cymbal-context/egmd.csv --workers 16
  # ENST는 c1·c4를 RIDE로 채점 (11/06 결정)
  uv run python scripts/cymbal_context_eval.py --dataset configs/bench/datasets/enst_minus_one.yaml \
      --features data/rule_features --enst-c1-ride --variants current,<고른 후보> --out ...
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
KICK_SEC = 0.03
_S: dict = {}


def variants() -> dict[str, tuple]:
    """이름 → (방식, w초, h초)"""
    out = {"current": ("none", 0.0, 0.0)}
    for w in (0.25, 0.4, 0.6, 0.8):
        for mode in ("run", "isolated", "both"):
            out[f"{mode}_w{round(w * 100):03d}"] = (mode, w, 0.0)
    for h in (0.5, 1.0, 2.0):
        out[f"hold_h{round(h * 10):02d}"] = ("hold", 0.0, h)
    return out


def apply_context(hits: np.ndarray, mode: str, w: float, h: float) -> np.ndarray:
    """예측 타격 표의 CRASH·RIDE 이름만 문맥으로 바꾼 복사본"""
    out = hits.copy()
    if mode == "none":
        return out
    cym = np.where(np.isin(out["pad"], ("CRASH", "RIDE")))[0]
    if not cym.size:
        return out
    t = out["time_sec"][cym]
    kicks = np.sort(out["time_sec"][out["pad"] == "KICK"])
    if mode == "hold":
        last_crash = -1e9
        for k, i in enumerate(cym):
            if t[k] - last_crash <= h:
                out["pad"][i] = "RIDE"
            elif out["pad"][i] == "CRASH":
                last_crash = t[k]
        return out
    for k, i in enumerate(cym):
        prev_ok = k > 0 and t[k] - t[k - 1] <= w
        next_ok = k + 1 < len(cym) and t[k + 1] - t[k] <= w
        if mode in ("run", "both") and prev_ok and next_ok:
            out["pad"][i] = "RIDE"
        elif mode in ("isolated", "both") and not prev_ok and not next_ok:
            if kicks.size and np.min(np.abs(kicks - t[k])) <= KICK_SEC:
                out["pad"][i] = "CRASH"
    return out


def _init(dataset_yaml: str, features: str, enst_c1_ride: bool, names: list[str]) -> None:
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
        variants={k: v for k, v in variants().items() if k in names},
    )


def song_rows(song_id: str) -> list[dict]:
    from ssaplash_ai.bench.analysis.rule_eval import predict_hits
    from ssaplash_ai.bench.analysis.rule_features import (
        feature_path,
        input_as_feature,
        load_features,
    )
    from ssaplash_ai.bench.metrics.hit_f1 import score_hits

    ds = _S["ds"]
    truth, _ = ds.hits_of(song_id)
    f = load_features(feature_path(_S["features"], ds.name, song_id))
    if "input" in f.stems:
        f.input_audio = f.stems.pop("input").astype(np.float16)
    else:
        f.input_audio = input_as_feature(ds.load(song_id).drums_true)
    pred = predict_hits(f, _S["rules"])
    kit = ds.kit_of(song_id) if hasattr(ds, "kit_of") else ""
    rows = []
    for name, (mode, w, h) in _S["variants"].items():
        s = score_hits(truth, apply_context(pred, mode, w, h), "pads")
        row = {"variant": name, "songId": song_id, "kit": kit}
        for p in SCORED:
            c = s.by_label.get(p)
            row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (c.tp, c.fp, c.fn) if c else (0, 0, 0)
        rows.append(row)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument("--variants", default="all", help="쉼표로 이름. all이면 전부")
    ap.add_argument("--enst-c1-ride", action="store_true", help="ENST c1·c4를 RIDE로 채점")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    names = list(variants()) if args.variants == "all" else args.variants.split(",")
    songs = load_dataset(DatasetConfig.from_yaml(args.dataset)).song_ids()
    print(f"[cymbal] 곡 {len(songs)}개 × 후보 {len(names)}개", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    init = (args.dataset, args.features, args.enst_c1_ride, names)
    with (
        open(args.out, "w", newline="", encoding="utf-8") as fh,
        Pool(args.workers, _init, init) as pool,
    ):
        w = None
        for i, rows in enumerate(pool.imap_unordered(song_rows, songs, chunksize=4), 1):
            if w is None:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), lineterminator="\n")
                w.writeheader()
            w.writerows(rows)
            if i % 200 == 0 or i == len(songs):
                print(f"[cymbal] {i}/{len(songs)}곡 ({time.time() - t0:.0f}초)", flush=True)
    print(f"[cymbal] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
