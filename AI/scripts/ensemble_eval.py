"""ADTOF 점수 평균(여러 가중치·여러 입력)으로 채보해 8패드 채점 (11/08, 학습 없는 개선 후보).

후보 하나 = 구성원 여러 개. 구성원 = 가중치@입력. 가중치는 default(ADTOF 원래 가중치) 또는 5종 출력 .pth 경로,
입력은 drums(분리 드럼, 서비스와 같음) · mix(원곡) · drums_lp(분리 드럼 + 원곡 0.3배).
구성원마다 ADTOF 프레임별 점수 (프레임, 5)를 내고 열마다 평균한 뒤(가중치@입력:열로 일부 열만 넣을 수 있음) 기본 가중치의 피크 고르기와 ADTOF + 드럼 킷 분리 규칙(`adtof_drumsep.yaml`)으로 8패드를 붙임.
출력 csv 한 줄 = (후보, 곡): 8패드 tp/fp/fn. postproc_eval.py의 f1_of·bootstrap으로 읽음.

  uv run python scripts/ensemble_eval.py --dataset configs/bench/datasets/public_songs.yaml \
      --cand base=default@drums --cand avg_mix=default@drums,default@mix --out data/results/ensemble/test31.csv
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
INPUTS = ("drums", "mix", "drums_lp")


COLS = "ksthc"  # ADTOF 점수 열 순서: 킥 35·스네어 38·탐 47·하이햇 42·심벌 49


def parse(spec: str) -> list[tuple[str, str, str]]:
    """가중치@입력:열 목록. 열은 이 구성원이 평균에 들어갈 점수 열(COLS 글자, 없으면 전부)."""
    out = []
    for m in spec.split(","):
        ckpt, _, rest = m.partition("@")
        inp, _, cols = rest.partition(":")
        inp = inp or "drums"
        cols = cols or COLS
        if inp not in INPUTS or set(cols) - set(COLS):
            raise SystemExit(f"입력은 {INPUTS} 중 하나, 열은 {COLS} 글자: {m}")
        out.append((ckpt, inp, cols))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument("--cand", action="append", required=True, help="이름=가중치@입력,가중치@입력")
    ap.add_argument(
        "--pads", default=None, help="8패드 가중치. 주면 후보마다 +cym_take·+cym_name 줄을 더 냄"
    )
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
    cands = {}
    for c in args.cand:
        name, spec = c.split("=", 1)
        cands[name] = parse(spec)
    models = {}
    for ck in {m[0] for ms in cands.values() for m in ms} | {"default"}:
        m = AdtofTranscriber(
            replace(cfg, checkpoint_path=None if ck == "default" else ck, thresholds=None),
            args.device,
        )
        m._load()
        m.loaded = True
        models[ck] = m
    picker = models["default"]
    pads_m = combo = None
    if args.pads:
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "pad_combo_eval", Path(__file__).parent / "pad_combo_eval.py"
        )
        combo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(combo)
        pads_m = AdtofTranscriber(
            replace(cfg, checkpoint_path=args.pads, thresholds=None), args.device
        )
        pads_m._load()
        pads_m.loaded = True
    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = None
        for sid in ds.song_ids():
            truth = ds.hits_of(sid)[0]
            feats = load_features(feature_path(Path(args.features), ds.name, sid))
            item = ds.load(sid)
            if "input" in feats.stems:
                mono = feats.stems.pop("input").astype(np.float32)
                drums = np.repeat(mono, 2, axis=0)
            else:
                drums = item.drums_true.astype(np.float32)
                mono = drums.mean(axis=0, keepdims=True)
            feats.input_audio = mono.astype(np.float16)
            mix = item.mixture.astype(np.float32)
            n = min(drums.shape[1], mix.shape[1])
            audio = {"drums": drums, "mix": mix[:, :n], "drums_lp": drums[:, :n] + 0.3 * mix[:, :n]}
            cache: dict[tuple[str, str], np.ndarray] = {}
            other = None
            if pads_m is not None:
                pk = pads_m.peaks(pads_m.activations(drums, feats.sample_rate))
                labels = [lab for lab, ts in pk.items() for _ in ts]
                times = [t for ts in pk.values() for t in ts]
                other = _relabel(
                    make_hits(times, labels, None, {p: p for p in set(labels)})[0], "pads"
                )
            for name, members in cands.items():
                acts = []
                for ck, inp, _cols in members:
                    key = (ck, inp)
                    if key not in cache:
                        cache[key] = models[ck].activations(audio[inp], feats.sample_rate)[:, :5]
                    acts.append(cache[key])
                k = min(len(a) for a in acts)
                act = np.zeros((k, 5), dtype=np.float32)
                for j, letter in enumerate(COLS):
                    use = [a[:k, j] for a, m in zip(acts, members, strict=True) if letter in m[2]]
                    act[:, j] = np.mean(use, axis=0)
                feats.activations = act
                feats.peaks = {
                    int(p): np.asarray(v, dtype=np.float64) for p, v in picker.peaks(act).items()
                }
                pred = predict_hits(feats, rules)
                variants = {name: pred}
                if other is not None:
                    base = _relabel(pred, "pads")
                    cym = combo.GROUPS["cym"]
                    variants[f"{name}+cym_take"] = combo.take(base, other, cym)
                    variants[f"{name}+cym_name"] = combo.rename(base, other, cym)
                for vname, vpred in variants.items():
                    s = score_hits(truth, vpred, "pads").by_label
                    row = {"candidate": vname, "songId": sid}
                    for p in SCORED:
                        c = s.get(p)
                        row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (
                            (c.tp, c.fp, c.fn) if c else (0, 0, 0)
                        )
                    if w is None:
                        w = csv.DictWriter(fh, fieldnames=list(row), lineterminator="\n")
                        w.writeheader()
                    w.writerow(row)
            print(f"[ensemble] {sid}", flush=True)
    print(f"[ensemble] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
