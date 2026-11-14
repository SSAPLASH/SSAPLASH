"""별도 환경 채보 모델 노트에 규칙 값을 골라 적용하고 8패드 채점 (11/10).

`scripts/train_ext/acts_to_notes.py`가 저장한 곡별 노트를 씀. 모델 yaml은 `train_ext/eval_run.py`가 만듦.
current는 실제 곡 학습 전에 서비스가 쓰던 ADTOF 기본 모델(`SERVICE_MODEL`)이고 비교 기준임.

fit: 고르기 데이터(검증 10곡)로 규칙 값을 고름 → json
- map: 모델 라벨 → 패드 대응표. 라벨 하나씩 8패드·버림 중 전체 8패드 F1이 가장 높은 것으로 바꿈(두 바퀴)
- offset: 노트 시각 전체를 옮기는 값(-40 ~ +40ms, 5ms 간격). 허용 오차 ±25ms 점수가 가장 높은 값으로 고름
- thr: 라벨별 점수 문턱값. 노트의 velocity에 저장된 봉우리 점수 × 1000에 적용
run: 고른 값을 다른 데이터에 적용해 후보별 csv와 요약을 냄. 요약은 후보별 8패드 F1, current 대비 차이와
  곡을 다시 뽑은 95% 구간, 패드별 F1
- current / alone: 모델 yaml 대응표 그대로 / map / map_off / map_off_thr
- five_rules: map_off_thr 결과를 킥·스네어·하이햇·탐·심벌로 접어 ADTOF 기본 모델의 규칙(드럼 킷 분리 + 규칙)에 넣음.
  ADTOF 자리에 이 모델을 넣은 것

  uv run python scripts/ext_rule_eval.py fit --dataset configs/bench/datasets/public_songs_val.yaml --model data/results/ext_notes/_models/strum_p3.yaml --out data/results/ext_notes/rules_strum_p3.json --no-map
  uv run python scripts/ext_rule_eval.py run --dataset configs/bench/datasets/public_songs.yaml --model data/results/ext_notes/_models/strum_p3.yaml --params data/results/ext_notes/rules_strum_p3.json --out data/results/ext_notes/ft_strum_p3_test31.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from functools import cache
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import yaml

SERVICE_MODEL = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
SCORED = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
TOMS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
FIVE = {"KICK": 35, "SNARE": 38, "HIHAT": 42, "CRASH": 49, "RIDE": 49, **dict.fromkeys(TOMS, 47)}
OFFSETS = [x / 1000 for x in range(-40, 45, 5)]
WINDOW, WINDOW_TIGHT = 0.05, 0.025  # 채점 허용 오차, 시각 옮김을 고를 때 쓰는 허용 오차
THRESHOLDS = list(range(0, 950, 50))
_S: dict = {}
_FOLDER: dict[str, str] = {}  # 모델 이름 → 노트 폴더 이름(yaml의 notes_dir)


def base_map(model: str) -> tuple[str, dict[str, str | None]]:
    """모델 yaml → (이름, 라벨 → 패드). 페달 하이햇은 채점에서 하이햇과 합쳐지므로 하이햇으로 둠."""
    cfg = yaml.safe_load(Path(model).read_text(encoding="utf-8"))
    table = {}
    for k, v in (cfg.get("labels") or {}).items():
        table[str(k)] = None if v == "__drop__" else ("HIHAT" if v == "HIHAT_PEDAL" else str(v))
    _FOLDER[cfg["name"]] = str(cfg.get("notes_dir") or cfg["name"])
    return cfg["name"], table


def load_notes(root: Path, name: str, dataset: str, sid: str):
    """곡 노트 → (시각, 라벨 문자열, 점수). 없으면 None."""
    file = f"{sid.replace('/', '__')}.npz"
    path = root / _FOLDER.get(name, name) / dataset / file
    if not path.is_file():
        return None
    z = np.load(path)
    return z["onset"], z["label"].astype(str), z["velocity"]


def apply(notes, table: dict, offset: float = 0.0, thr: dict | None = None) -> np.ndarray:
    """노트에 대응표·시각 옮기기·문턱값을 적용한 8패드 타격 표."""
    from ssaplash_ai.bench.datasets.pads import HITS_DTYPE

    onset, label, score = notes
    pads = [table.get(x) for x in label]
    keep = [
        i for i, p in enumerate(pads) if p is not None and score[i] >= (thr or {}).get(label[i], -1)
    ]
    out = np.zeros(len(keep), dtype=HITS_DTYPE)
    out["time_sec"] = onset[keep] + offset
    out["pad"] = [pads[i] for i in keep]
    return out[np.argsort(out["time_sec"], kind="stable")]


def set_enst_ride(enabled: bool) -> None:
    if enabled:
        import ssaplash_ai.bench.datasets.enst as enst

        enst.ENST_LABEL_PAD["c1"] = "RIDE"
        enst.ENST_LABEL_PAD["c4"] = "RIDE"


# ---------- fit ----------


def cmd_fit(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
    from ssaplash_ai.bench.datasets.pads import HITS_DTYPE
    from ssaplash_ai.bench.metrics.hit_f1 import _relabel, score_hits

    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    name, table = base_map(args.model)
    songs = []
    for sid in ds.song_ids():
        notes = load_notes(Path(args.notes), name, ds.name, sid)
        if notes is not None:
            songs.append((_relabel(ds.hits_of(sid)[0], "pads"), notes))
    labels = sorted({x for _, n in songs for x in n[1]})
    has_score = any((n[2] >= 0).any() for _, n in songs)
    print(f"[fit] {name} 곡 {len(songs)} 라벨 {len(labels)} 점수 {'있음' if has_score else '없음'}")

    def hits_of(times: np.ndarray, pad: str) -> np.ndarray:
        out = np.zeros(len(times), dtype=HITS_DTYPE)
        out["time_sec"] = np.sort(times)
        out["pad"] = pad
        return out

    @cache
    def pad_counts(
        pad: str, members: tuple, offset: float, window: float = WINDOW
    ) -> tuple[int, int, int]:
        """패드 하나에 (라벨, 문턱값) 묶음을 대응시켰을 때 전체 곡의 tp·fp·fn."""
        tp = fp = fn = 0
        for truth, (onset, label, score) in songs:
            mask = np.zeros(len(onset), dtype=bool)
            for lab, th in members:
                mask |= (label == lab) & (score >= th)
            c = score_hits(
                truth[truth["pad"] == pad],
                hits_of(onset[mask] + offset, pad),
                "pads",
                window_sec=window,
            )
            c = c.by_label.get(pad)
            if c:
                tp, fp, fn = tp + c.tp, fp + c.fp, fn + c.fn
        return tp, fp, fn

    def total(tb: dict, offset: float, thr: dict, window: float = WINDOW) -> float:
        tp = fp = fn = 0
        for pad in SCORED:
            members = tuple(sorted((lab, thr.get(lab, -1)) for lab, p in tb.items() if p == pad))
            a, b, c = pad_counts(pad, members, offset, window)
            tp, fp, fn = tp + a, fp + b, fn + c
        return 2 * tp / max(2 * tp + fp + fn, 1)

    tb = {lab: table.get(lab) for lab in labels}
    thr: dict[str, int] = {}
    start = total(tb, 0.0, thr)
    best = start
    if has_score:
        # 점수가 있는 모델은 낮은 점수 봉우리까지 저장돼 있어, 문턱값을 먼저 골라야 대응표 고르기가 뜻이 있음
        for lab in labels:
            if tb.get(lab) is None:
                continue
            for th in THRESHOLDS:
                trial = {**thr, lab: th}
                f = total(tb, 0.0, trial)
                if f > best + 1e-4:
                    best, thr = f, trial
        print(f"[fit] 문턱값 먼저 {best:.4f} {thr}")
    for _ in range(0 if args.no_map else 2):
        for lab in labels:
            for option in (*SCORED, None):
                trial = {**tb, lab: option}
                f = total(trial, 0.0, thr)
                if f > best + 1e-4:
                    best, tb = f, trial
    f_map = best
    # 시각 옮김은 허용 오차 ±25ms 점수로 고름. ±50ms에서는 −20 ~ +20ms 사이 점수 차이가 0.005 안쪽이라
    # 정답과 20ms 넘게 어긋난 값이 뽑힐 수 있음(11/11: 학습한 STRUM에 −20ms가 뽑혔고 그때 ±25ms F1이 0.795 → 0.359)
    offset = max(OFFSETS, key=lambda o: (total(tb, o, thr, WINDOW_TIGHT), -abs(o)))
    f_off = total(tb, offset, thr)
    if has_score:
        best = f_off
        for _ in range(2):
            for lab in labels:
                if tb.get(lab) is None:
                    continue
                for th in THRESHOLDS:
                    trial = {**thr, lab: th}
                    f = total(tb, offset, trial)
                    if f > best + 1e-4:
                        best, thr = f, trial
    f_thr = total(tb, offset, thr)
    changed = {lab: (table.get(lab), tb[lab]) for lab in labels if table.get(lab) != tb[lab]}
    print(
        f"[fit] 대응표 그대로 {start:.4f} → map {f_map:.4f} → offset {offset * 1000:+.0f}ms {f_off:.4f}"
    )
    print(f"[fit] → thr {f_thr:.4f}  바뀐 라벨 {changed}  문턱값 {thr}")
    out = {"model": name, "map": tb, "offset": offset, "thr": thr}
    out["fit"] = {"alone": start, "map": f_map, "map_off": f_off, "map_off_thr": f_thr}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


# ---------- run ----------


def init(ds_yaml: str, features: str, notes: str, model: str, params: str, enst: bool) -> None:
    set_enst_ride(enst)
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    _S["ds"] = load_dataset(DatasetConfig.from_yaml(ds_yaml))
    _S["features"], _S["notes"] = Path(features), Path(notes)
    _S["name"], _S["table"] = base_map(model)
    _S["params"] = json.loads(Path(params).read_text(encoding="utf-8"))
    _S["rules"] = yaml.safe_load(SERVICE_MODEL.read_text(encoding="utf-8"))["rules"]


def five_peaks(hits: np.ndarray, min_gap: float = 0.03) -> dict[int, np.ndarray]:
    """8패드 타격 → ADTOF 5종 번호별 시각. 접으면서 생긴 30ms 안 겹침은 하나로."""
    peaks = {}
    for pitch in sorted(set(FIVE.values())):
        t = np.sort(hits["time_sec"][[FIVE.get(p) == pitch for p in hits["pad"]]])
        keep = np.ones(len(t), dtype=bool)
        last = -np.inf
        for i, x in enumerate(t):
            keep[i] = x - last >= min_gap
            last = x if keep[i] else last
        peaks[pitch] = t[keep]
    return peaks


def song_rows(sid: str) -> list[dict]:
    from ssaplash_ai.bench.analysis.rule_eval import predict_hits
    from ssaplash_ai.bench.analysis.rule_features import feature_path, load_features
    from ssaplash_ai.bench.metrics.hit_f1 import _relabel, score_hits

    ds, prm = _S["ds"], _S["params"]
    notes = load_notes(_S["notes"], _S["name"], ds.name, sid)
    if notes is None:
        return []
    truth = ds.hits_of(sid)[0]
    feats = load_features(feature_path(_S["features"], ds.name, sid))
    if "input" in feats.stems:
        mono = feats.stems.pop("input").astype(np.float32)
    else:
        mono = ds.load(sid).drums_true.astype(np.float32).mean(axis=0, keepdims=True)
    feats.input_audio = mono.astype(np.float16)
    tuned = apply(notes, prm["map"], prm["offset"], prm["thr"])
    preds = {
        "current": predict_hits(feats, _S["rules"]),
        "alone": apply(notes, _S["table"]),
        "map": apply(notes, prm["map"]),
        "map_off": apply(notes, prm["map"], prm["offset"]),
        "map_off_thr": tuned,
    }
    feats.peaks = five_peaks(tuned)
    feats.activations = None
    preds["five_rules"] = predict_hits(feats, _S["rules"])
    rows = []
    for name, pred in preds.items():
        s = score_hits(truth, _relabel(pred, "pads"), "pads").by_label
        row = {"candidate": name, "songId": sid}
        for p in SCORED:
            c = s.get(p)
            row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (c.tp, c.fp, c.fn) if c else (0, 0, 0)
        rows.append(row)
    return rows


def summary(csv_path: Path) -> None:
    """후보별 8패드 F1, current 대비 차이와 곡을 다시 뽑은 95% 구간, 패드별 F1을 찍음."""
    import pandas as pd

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from postproc_eval import bootstrap, f1_of

    df = pd.read_csv(csv_path)
    names = [n for n in df.candidate.unique() if n != "current"]
    diffs = bootstrap(df, names)
    print(f"곡 {df.songId.nunique()}  " + "후보 8패드F1 차이(95% 구간) | " + " ".join(SCORED))
    for name in ["current", *names]:
        g = df[df.candidate == name]
        pads = " ".join(f"{f1_of(g, (p,)):.3f}" for p in SCORED)
        tail = ""
        if name != "current":
            d, lo, hi = diffs[name]
            tail = f" {d:+.3f} ({lo:+.3f} ~ {hi:+.3f})"
        print(f"{name:10s} {f1_of(g):.3f}{tail} | {pads}")


def cmd_run(args: argparse.Namespace) -> int:
    init_args = (
        args.dataset,
        args.features,
        args.notes,
        args.model,
        args.params,
        args.enst_c1_ride,
    )
    init(*init_args)
    songs = [s for s in _S["ds"].song_ids() if args.only is None or args.only in s]
    with Pool(args.workers, initializer=init, initargs=init_args) as pool:
        rows = [r for rs in pool.map(song_rows, songs) for r in rs]
    if not rows:
        print("[ext_rule_eval] 채점할 곡이 없음")
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"[ext_rule_eval] 곡 {len({r['songId'] for r in rows})}/{len(songs)} 저장 {args.out}")
    summary(args.out)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("fit", "run"):
        p = sub.add_parser(cmd)
        p.add_argument("--dataset", required=True)
        p.add_argument("--model", required=True, help="모델 yaml")
        p.add_argument("--notes", default="data/results/ext_notes", help="노트 폴더")
        p.add_argument("--out", type=Path, required=True)
    sub.choices["fit"].add_argument(
        "--no-map", action="store_true", help="라벨 대응은 yaml 그대로 두고 시각·문턱값만 고름"
    )
    run = sub.choices["run"]
    run.add_argument("--features", default="data/rule_features")
    run.add_argument("--params", required=True, help="fit이 쓴 json")
    run.add_argument("--enst-c1-ride", action="store_true")
    run.add_argument("--only", default=None, help="곡 이름에 이 글자가 든 곡만")
    run.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    return cmd_fit(args) if args.cmd == "fit" else cmd_run(args)


if __name__ == "__main__":
    raise SystemExit(main())
