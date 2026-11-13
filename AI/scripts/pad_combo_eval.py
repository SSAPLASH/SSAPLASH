"""ADTOF + 드럼 킷 분리 채보와 8패드 학습 모델을 패드별로 섞어 채점 (11/08, expand.md 다음 후보).

아래에서 서비스 채보·서비스 규칙은 11/08 당시 서비스이던 ADTOF + 드럼 킷 분리(`adtof_drumsep.yaml`)를 가리킴.
곡마다 서비스 채보(기본 ADTOF 또는 --base 가중치 + 서비스 규칙)와 8패드 모델 채보를 만들고 아래 조합을 셈.
- base: 서비스 그대로
- cym_name: 서비스 크래시·라이드 타격의 이름만, 50ms 안 8패드 모델의 가장 가까운 크래시·라이드 이름으로
- tom_name: 서비스 탐 타격의 이름만, 50ms 안 8패드 모델의 가장 가까운 탐 이름으로
- both_name: 둘 다
- cym_take: 크래시·라이드 타격을 8패드 모델 것으로 통째로 바꿈 (나머지는 서비스)
- tom_take: 탐 타격을 8패드 모델 것으로 통째로
- both_take: 둘 다 통째로
출력 csv 한 줄 = (조합, 곡): 8패드 tp/fp/fn. postproc_eval.py의 f1_of·bootstrap으로 읽음.

  uv run python scripts/pad_combo_eval.py --dataset configs/bench/datasets/public_songs_val.yaml \
      --features data/rule_features --pads data/models/songsterr_ft/pads_all_noguard/last.pth --out data/results/pad_combo/val.csv
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import replace
from pathlib import Path

import numpy as np
import yaml

SERVICE_MODEL = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
SCORED = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
GROUPS = {"cym": ("CRASH", "RIDE"), "tom": ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")}
NEAR = 0.05


def rename(base: np.ndarray, other: np.ndarray, pads: tuple[str, ...]) -> np.ndarray:
    """base의 pads 타격 이름을 NEAR 안 other의 가장 가까운 같은 묶음 타격 이름으로. 없으면 그대로."""
    out = base.copy()
    o = other[np.isin(other["pad"], pads)]
    if not len(o):
        return out
    ot = o["time_sec"]
    for i in np.flatnonzero(np.isin(out["pad"], pads)):
        d = np.abs(ot - out["time_sec"][i])
        j = int(np.argmin(d))
        if d[j] <= NEAR:
            out["pad"][i] = o["pad"][j]
    return out


def take(base: np.ndarray, other: np.ndarray, pads: tuple[str, ...]) -> np.ndarray:
    """base의 pads 타격을 빼고 other의 pads 타격을 넣음."""
    out = np.concatenate([base[~np.isin(base["pad"], pads)], other[np.isin(other["pad"], pads)]])
    return out[np.argsort(out["time_sec"], kind="stable")]


def combos(base: np.ndarray, other: np.ndarray) -> dict[str, np.ndarray]:
    cym, tom = GROUPS["cym"], GROUPS["tom"]
    return {
        "base": base,
        "cym_name": rename(base, other, cym),
        "tom_name": rename(base, other, tom),
        "both_name": rename(rename(base, other, cym), other, tom),
        "cym_take": take(base, other, cym),
        "tom_take": take(base, other, tom),
        "both_take": take(take(base, other, cym), other, tom),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument("--pads", required=True, help="8패드 출력 가중치")
    ap.add_argument("--base", default="default", help="ADTOF 가중치. default면 원래 ADTOF 가중치")
    ap.add_argument("--prefix", default="", help="조합 이름 앞에 붙일 말")
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
    from ssaplash_ai.bench.metrics.hit_f1 import _relabel, score_hits
    from ssaplash_ai.bench.transcribers import TranscriberConfig
    from ssaplash_ai.bench.transcribers.adtof_transcriber import AdtofTranscriber

    rules = yaml.safe_load(SERVICE_MODEL.read_text(encoding="utf-8"))["rules"]
    cfg = TranscriberConfig.from_yaml(SERVICE_MODEL)

    def model(path: str) -> AdtofTranscriber:
        m = AdtofTranscriber(
            replace(cfg, checkpoint_path=None if path == "default" else path, thresholds=None),
            args.device,
        )
        m._load()
        m.loaded = True
        return m

    base_m, pads_m = model(args.base), model(args.pads)
    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = None
        for sid in ds.song_ids():
            truth = ds.hits_of(sid)[0]
            feats = load_features(feature_path(Path(args.features), ds.name, sid))
            if "input" in feats.stems:
                mono = feats.stems.pop("input").astype(np.float32)
                audio = np.repeat(mono, 2, axis=0)
            else:
                audio = ds.load(sid).drums_true.astype(np.float32)
                mono = audio.mean(axis=0, keepdims=True)
            feats.input_audio = mono.astype(np.float16)
            act = base_m.activations(audio, feats.sample_rate)
            feats.peaks = {
                int(k): np.asarray(v, dtype=np.float64) for k, v in base_m.peaks(act).items()
            }
            feats.activations = act[:, :5].astype(np.float32)
            base = _relabel(predict_hits(feats, rules), "pads")
            peaks = pads_m.peaks(pads_m.activations(audio, feats.sample_rate))
            labels = [lab for lab, ts in peaks.items() for _ in ts]
            times = [t for ts in peaks.values() for t in ts]
            other = _relabel(make_hits(times, labels, None, {p: p for p in set(labels)})[0], "pads")
            for name, pred in combos(base, other).items():
                s = score_hits(truth, pred, "pads").by_label
                row = {"candidate": args.prefix + name, "songId": sid}
                for p in SCORED:
                    c = s.get(p)
                    row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (
                        (c.tp, c.fp, c.fn) if c else (0, 0, 0)
                    )
                if w is None:
                    w = csv.DictWriter(fh, fieldnames=list(row), lineterminator="\n")
                    w.writeheader()
                w.writerow(row)
    print(f"[combo] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
