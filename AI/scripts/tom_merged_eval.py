"""탐 3종을 "탐" 하나로 합쳐 채점 (11/08). 모델마다 저장 특징의 분리 트랙에 ADTOF를 다시 돌리고 `adtof_drumsep.yaml` 규칙으로 패드를
붙인 뒤(8패드 출력 모델은 모델이 낸 패드 그대로), 정답·예측의 스몰·미드·플로어 탐을 하나로 바꿔 ±50ms로 셈.
출력 csv 한 줄 = (모델, 곡): 7패드(킥·스네어·하이햇·탐·크래시·라이드, 페달은 하이햇) tp/fp/fn.

  uv run python scripts/tom_merged_eval.py --dataset configs/bench/datasets/public_songs.yaml \
      --features data/rule_features --ckpt current=default --ckpt five=<가중치.pth> --out data/results/tom_merged/public31.csv
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import replace
from pathlib import Path

import numpy as np
import yaml

SERVICE_MODEL = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
TOMS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
MERGED = ("KICK", "SNARE", "HIHAT", "TOM", "CRASH", "RIDE")


def merge_toms(hits: np.ndarray) -> np.ndarray:
    """탐 3종 → TOM. pads 기준 채점이 패드 이름을 검사하므로 이름은 FLOOR_TOM으로 두고 결과에서 TOM으로 읽음."""
    out = hits.copy()
    out["pad"][np.isin(out["pad"], TOMS)] = "FLOOR_TOM"
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument("--ckpt", action="append", required=True, help="이름=가중치 경로 또는 default")
    ap.add_argument("--enst-c1-ride", action="store_true")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    if args.enst_c1_ride:
        import ssaplash_ai.bench.datasets.enst as enst

        enst.ENST_LABEL_PAD["c1"] = "RIDE"
        enst.ENST_LABEL_PAD["c4"] = "RIDE"
    from ssaplash_ai.bench.analysis.rule_eval import predict_hits
    from ssaplash_ai.bench.analysis.rule_features import feature_path, load_features
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
    from ssaplash_ai.bench.datasets.pads import make_hits
    from ssaplash_ai.bench.metrics.hit_f1 import score_hits
    from ssaplash_ai.bench.transcribers import TranscriberConfig
    from ssaplash_ai.bench.transcribers.adtof_transcriber import AdtofTranscriber

    rules = yaml.safe_load(SERVICE_MODEL.read_text(encoding="utf-8"))["rules"]
    base_cfg = TranscriberConfig.from_yaml(SERVICE_MODEL)
    models = {}
    for spec in args.ckpt:
        name, path = spec.split("=", 1)
        m = AdtofTranscriber(
            replace(base_cfg, checkpoint_path=None if path == "default" else path, thresholds=None),
            args.device,
        )
        m._load()
        m.loaded = True
        models[name] = m
    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = None
        for sid in ds.song_ids():
            truth = merge_toms(ds.hits_of(sid)[0])
            feats = load_features(feature_path(Path(args.features), ds.name, sid))
            if "input" in feats.stems:
                mono = feats.stems.pop("input").astype(np.float32)
                audio = np.repeat(mono, 2, axis=0)
            else:
                audio = ds.load(sid).drums_true.astype(np.float32)
                mono = audio.mean(axis=0, keepdims=True)
            feats.input_audio = mono.astype(np.float16)
            for name, m in models.items():
                act = m.activations(audio, feats.sample_rate)
                peaks = m.peaks(act)
                if all(isinstance(k, int) for k in peaks):
                    feats.peaks = {
                        int(k): np.asarray(v, dtype=np.float64) for k, v in peaks.items()
                    }
                    feats.activations = act[:, :5].astype(np.float32)
                    pred = predict_hits(feats, rules)
                else:
                    labels = [lab for lab, ts in peaks.items() for _ in ts]
                    times = [t for ts in peaks.values() for t in ts]
                    pred, _ = make_hits(times, labels, None, {p: p for p in set(labels)})
                s = score_hits(truth, merge_toms(pred), "pads").by_label
                row = {"candidate": name, "songId": sid}
                for p in MERGED:
                    c = s.get("FLOOR_TOM" if p == "TOM" else p)
                    row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (
                        (c.tp, c.fp, c.fn) if c else (0, 0, 0)
                    )
                if w is None:
                    w = csv.DictWriter(fh, fieldnames=list(row), lineterminator="\n")
                    w.writeheader()
                w.writerow(row)
    print(f"[tom-merged] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
