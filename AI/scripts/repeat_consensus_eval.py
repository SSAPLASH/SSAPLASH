"""반복 마디끼리 ADTOF 점수를 섞어 채보 (11/08, 학습 없는 개선 후보).

곡은 같은 마디 패턴이 되풀이되므로, 한 마디에서 놓친 타격이 비슷한 다른 마디에서는 잡혔을 수 있음.
1. Beat This!를 분리 드럼에 돌려 마디 첫 박을 찾음
2. 마디마다 저장 특징의 ADTOF 점수 (프레임, 5)를 마디 길이에 맞춰 R칸으로 늘이거나 줄임
3. 마디끼리 상관계수가 tau 이상인 마디 중 가장 비슷한 k개의 평균을 그 마디 길이로 되돌려
   점수 = (1 − alpha) × 원래 + alpha × 이웃 평균
4. 기본 가중치 피크 고르기 + ADTOF + 드럼 킷 분리 규칙(`adtof_drumsep.yaml`)으로 8패드
출력 csv 한 줄 = (후보, 곡): 8패드 tp/fp/fn. 박 추정 결과는 --beats-cache 폴더에 곡마다 저장.

  uv run python scripts/repeat_consensus_eval.py --dataset configs/bench/datasets/public_songs.yaml \
      --out data/results/repeat/test31.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
import yaml

SERVICE_MODEL = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
SCORED = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
FPS = 100
R = 192
GRID = [
    {"name": "current"},
    *[
        {"name": f"rep_a{a:g}_t{t:g}_k{k}", "alpha": a, "tau": t, "k": k}
        for a in (0.2, 0.35, 0.5)
        for t in (0.5, 0.7)
        for k in (2, 4)
    ],
]


def bar_frames(downbeats: np.ndarray, n_frames: int) -> list[tuple[int, int]]:
    """마디 첫 박 시각 → (시작 프레임, 끝 프레임) 목록. 마지막 마디는 앞 마디 길이로 닫음."""
    db = np.asarray(downbeats, dtype=np.float64)
    if len(db) < 2:
        return []
    ends = np.append(db[1:], db[-1] + (db[-1] - db[-2]))
    out = []
    for s, e in zip(db, ends, strict=True):
        a, b = int(round(s * FPS)), int(round(e * FPS))
        if b - a >= 8 and b <= n_frames:
            out.append((a, b))
    return out


def resample(seg: np.ndarray, n: int) -> np.ndarray:
    """(프레임, 열) → (n, 열) 선형 보간."""
    x_old = np.linspace(0.0, 1.0, len(seg), endpoint=False)
    x_new = np.linspace(0.0, 1.0, n, endpoint=False)
    return np.stack([np.interp(x_new, x_old, seg[:, c]) for c in range(seg.shape[1])], axis=1)


def consensus(
    act: np.ndarray, bars: list[tuple[int, int]], alpha: float, tau: float, k: int
) -> np.ndarray:
    """비슷한 마디 k개 평균을 섞은 점수. 마디가 4개보다 적으면 그대로."""
    if len(bars) < 4:
        return act
    vecs = np.stack([resample(act[a:b], R) for a, b in bars])  # (마디, R, 5)
    flat = vecs.reshape(len(bars), -1)
    flat = flat - flat.mean(axis=1, keepdims=True)
    norm = np.linalg.norm(flat, axis=1, keepdims=True) + 1e-9
    sim = (flat / norm) @ (flat / norm).T
    np.fill_diagonal(sim, -np.inf)
    out = act.copy()
    for i, (a, b) in enumerate(bars):
        order = np.argsort(-sim[i])[:k]
        nb = [j for j in order if sim[i, j] >= tau]
        if not nb:
            continue
        mean = resample(vecs[nb].mean(axis=0), b - a)
        out[a:b] = (1 - alpha) * act[a:b] + alpha * mean
    return out.astype(np.float32)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument("--beats-cache", type=Path, default=Path("data/results/repeat/beats"))
    ap.add_argument("--enst-c1-ride", action="store_true")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    if args.enst_c1_ride:
        import ssaplash_ai.bench.datasets.enst as enst

        enst.ENST_LABEL_PAD["c1"] = "RIDE"
        enst.ENST_LABEL_PAD["c4"] = "RIDE"
    from dataclasses import replace

    from ssaplash_ai.bench.analysis.rule_eval import predict_hits
    from ssaplash_ai.bench.analysis.rule_features import feature_path, load_features
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
    from ssaplash_ai.bench.metrics.hit_f1 import score_hits
    from ssaplash_ai.bench.transcribers import TranscriberConfig
    from ssaplash_ai.bench.transcribers.adtof_transcriber import AdtofTranscriber

    rules = yaml.safe_load(SERVICE_MODEL.read_text(encoding="utf-8"))["rules"]
    picker = AdtofTranscriber(
        replace(TranscriberConfig.from_yaml(SERVICE_MODEL), checkpoint_path=None, thresholds=None),
        "cpu",
    )
    picker._load()
    beat_model = None
    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    cache = args.beats_cache / ds.name
    cache.mkdir(parents=True, exist_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = None
        for sid in ds.song_ids():
            truth = ds.hits_of(sid)[0]
            feats = load_features(feature_path(Path(args.features), ds.name, sid))
            if "input" in feats.stems:
                mono = feats.stems.pop("input").astype(np.float32)
            else:
                mono = ds.load(sid).drums_true.astype(np.float32).mean(axis=0, keepdims=True)
            feats.input_audio = mono.astype(np.float16)
            bp = cache / f"{sid.replace('/', '__')}.npz"
            if bp.is_file():
                downbeats = np.load(bp)["downbeats"]
            else:
                if beat_model is None:
                    from beat_this.inference import Audio2Beats

                    from ssaplash_ai.chart.tempo import ensure_beat_this_checkpoint

                    beat_model = Audio2Beats(
                        checkpoint_path=str(ensure_beat_this_checkpoint()),
                        device=args.device,
                        dbn=False,
                    )
                beats, downbeats = beat_model(mono[0], feats.sample_rate)
                np.savez(bp, beats=np.asarray(beats), downbeats=np.asarray(downbeats))
            act0 = np.asarray(feats.activations, dtype=np.float32)[:, :5]
            bars = bar_frames(downbeats, len(act0))
            for cand in GRID:
                act = (
                    act0
                    if cand["name"] == "current"
                    else consensus(act0, bars, cand["alpha"], cand["tau"], cand["k"])
                )
                feats.activations = act
                feats.peaks = {
                    int(p): np.asarray(v, dtype=np.float64) for p, v in picker.peaks(act).items()
                }
                s = score_hits(truth, predict_hits(feats, rules), "pads").by_label
                row = {"candidate": cand["name"], "songId": sid}
                for p in SCORED:
                    c = s.get(p)
                    row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (
                        (c.tp, c.fp, c.fn) if c else (0, 0, 0)
                    )
                if w is None:
                    w = csv.DictWriter(fh, fieldnames=list(row), lineterminator="\n")
                    w.writeheader()
                w.writerow(row)
            print(f"[repeat] {sid} 마디 {len(bars)}", flush=True)
    print(f"[repeat] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
