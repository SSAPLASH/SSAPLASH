"""파인튜닝한 ADTOF 가중치를 ADTOF + 드럼 킷 분리 규칙으로 채점 (ai_2_to_4.md 8.11 파인튜닝 가설, 11/07 실험).

저장한 특징(rule-features)의 드럼 킷 분리 트랙은 그대로 두고 ADTOF만 가중치마다 다시 돌림. 입력 드럼은 특징에
stem_input이 있으면(원곡 분리 입력) 그것, 없으면 데이터셋의 정답 드럼 트랙. 5클래스 가중치는 `adtof_drumsep.yaml` 규칙(탐 그룹·심벌
에너지)으로 패드를 붙이고, 패드 직접 출력 가중치(classes pads)는 모델이 낸 패드 이름을 그대로 씀.
출력 csv는 `tom_rule_eval_stream.py`와 같은 열이라 `tom_rule_pick.py enst`로 비교할 수 있음(candidate 열 = 가중치 이름).

  uv run python scripts/adtof_ckpt_eval.py --dataset configs/bench/datasets/enst_minus_one.yaml \
      --features data/rule_features --ckpt current=default --ckpt h3_sep=data/models/adtof_ft/h3_sep30/best.pth \
      --two-tom-upper MID_TOM --out data/results/finetune/enst_drums.csv
"""

from __future__ import annotations

import argparse
import csv
import time
from dataclasses import replace
from pathlib import Path

import numpy as np

SERVICE_MODEL = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
TOM_PADS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument("--ckpt", action="append", required=True, help="이름=가중치 경로 또는 default")
    ap.add_argument("--two-tom-upper", choices=["MID_TOM", "SMALL_TOM"], default=None)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument(
        "--enst-c1-ride", action="store_true", help="ENST c1·c4를 RIDE로 채점 (11/06 결정)"
    )
    args = ap.parse_args()
    import yaml

    if args.enst_c1_ride:
        import ssaplash_ai.bench.datasets.enst as enst

        enst.ENST_LABEL_PAD["c1"] = "RIDE"
        enst.ENST_LABEL_PAD["c4"] = "RIDE"

    from ssaplash_ai.bench.analysis.rule_eval import (
        GroupResult,
        eval_song,
        group_confusion,
        rename_two_tom_upper,
    )
    from ssaplash_ai.bench.analysis.rule_features import feature_path, load_features
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
    from ssaplash_ai.bench.datasets.pads import SCORED_PADS, make_hits
    from ssaplash_ai.bench.metrics.hit_f1 import score_hits
    from ssaplash_ai.bench.transcribers import TranscriberConfig
    from ssaplash_ai.bench.transcribers.adtof_transcriber import AdtofTranscriber

    rules = yaml.safe_load(SERVICE_MODEL.read_text(encoding="utf-8"))["rules"]
    base_cfg = TranscriberConfig.from_yaml(SERVICE_MODEL)
    models = {}
    for spec in args.ckpt:
        name, path = spec.split("=", 1)
        cfg = replace(
            base_cfg, checkpoint_path=None if path == "default" else path, thresholds=None
        )
        m = AdtofTranscriber(cfg, args.device)
        m._load()
        m.loaded = True
        models[name] = m
        print(f"[ckpt] {name}: 라벨 {m._labels}", flush=True)
    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    songs = ds.song_ids()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = None
        for i, sid in enumerate(songs, 1):
            truth, _ = ds.hits_of(sid)
            if args.two_tom_upper:
                truth = rename_two_tom_upper(truth, args.two_tom_upper)
            feats = load_features(feature_path(Path(args.features), ds.name, sid))
            if "input" in feats.stems:
                # 분리 입력 특징은 모노로만 저장돼 있어 두 채널로 복사해 넣음
                mono = feats.stems.pop("input").astype(np.float32)
                audio = np.repeat(mono, 2, axis=0)
            else:
                # 드럼 단독은 rule-features와 같게 데이터셋의 스테레오 드럼 트랙을 그대로 넣음
                audio = ds.load(sid).drums_true.astype(np.float32)
                mono = audio.mean(axis=0, keepdims=True)
            feats.input_audio = mono.astype(np.float16)
            kinds = len({str(p) for p in truth["pad"] if str(p) in TOM_PADS})
            for name, m in models.items():
                act = m.activations(audio, feats.sample_rate)
                peaks = m.peaks(act)
                if all(isinstance(k, int) for k in peaks):
                    feats.peaks = {
                        int(k): np.asarray(v, dtype=np.float64) for k, v in peaks.items()
                    }
                    feats.activations = act[:, :5].astype(np.float32) if act.shape[1] >= 5 else act
                    ev = eval_song(sid, feats, truth, rules)
                    pads, tom, clusters = ev.pads, ev.tom, ev.tom_clusters
                else:
                    labels = [lab for lab, ts in peaks.items() for _ in ts]
                    times = [t for ts in peaks.values() for t in ts]
                    pred, _ = make_hits(times, labels, None, {p: p for p in set(labels)})
                    pads = score_hits(truth, pred, "pads").by_label
                    tom = group_confusion(truth, pred, TOM_PADS) if pred.size else GroupResult()
                    clusters = len({str(p) for p in pred["pad"] if str(p) in TOM_PADS})
                row = {
                    "candidate": name,
                    "songId": sid,
                    "tomTrueKinds": kinds,
                    "tomMatched": tom.matched,
                    "tomCorrect": tom.correct,
                    "tomFalseKept": tom.false_kept,
                    "tomClusters": clusters,
                }
                for p in SCORED_PADS:
                    c = pads.get(p)
                    row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (
                        (c.tp, c.fp, c.fn) if c else (0, 0, 0)
                    )
                if writer is None:
                    writer = csv.DictWriter(fh, fieldnames=list(row.keys()), lineterminator="\n")
                    writer.writeheader()
                writer.writerow(row)
            if i % 10 == 0 or i == len(songs):
                print(f"[ckpt] {i}/{len(songs)}곡 ({time.time() - t0:.0f}초)", flush=True)
    print(f"[ckpt] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
