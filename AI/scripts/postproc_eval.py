"""채보 후처리 후보 채점·고르기.

저장 특징의 ADTOF 프레임별 점수로 피크를 다시 고르고(thr·co), ADTOF + 드럼 킷 분리 규칙(`adtof_drumsep.yaml`)으로 예측한 뒤, 탐·하이햇 타격을
스네어로 바꾸는(tom2sn·hh2sn) 후처리를 후보마다 걸어 8패드 tp/fp/fn을 곡마다 셈.

- grid: 후보 목록 json (한 가지씩 바꾼 후보 + current)
- run: 데이터셋 × 후보 → 곡·후보별 개수 csv
- select: MDB로 후보 묶음마다 하나씩 고르고(E-GMD가 0.005 넘게 떨어지면 뺌), 오른 것을 차례로 더한 조합 json
- enst: ENST 곡별 csv 두 개(드럼 단독·원곡 분리)로 current 후보 대비 차이와 같은 곡끼리 다시 뽑은 95% 구간

  uv run python scripts/postproc_eval.py grid --out data/results/postproc/grid.json
  uv run python scripts/postproc_eval.py run --dataset configs/bench/datasets/mdb_drums.yaml \
      --candidates data/results/postproc/grid.json --out data/results/postproc/mdb.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

SERVICE_RULES = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
SCORED = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
LABELS = (35, 38, 47, 42, 49)  # ADTOF 점수 열 순서
BASE_THR = {35: 0.22, 38: 0.24, 47: 0.32, 42: 0.22, 49: 0.30}  # ADTOF 기본 문턱값
FPS = 100
NEAR_SEC = 0.02
TOMS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
FAMILIES = ("thr", "co", "tom2sn", "hh2sn", "gate", "k2t", "cref")
_S: dict = {}


# ---------- 후처리 ----------


def grid() -> list[dict]:
    out = [{"name": "current"}]
    for m in (0.5, 0.6, 0.7, 0.85, 1.0):
        for c in (0.7, 0.85, 1.0):
            if (m, c) != (1.0, 1.0):
                out.append({"name": f"thr_m{m:g}_c{c:g}", "thr_m": m, "thr_c": c})
    for r in (0.5, 0.7, 0.85):
        out.append({"name": f"co_r{r:g}", "co_r": r})
    for fam in ("tom2sn", "hh2sn"):
        for s in (0.3, 0.5, 0.7, 1.0):
            out.append({"name": f"{fam}_s{s:g}", fam: s})
    return out


def family(cand: dict) -> str | None:
    if "rules" in cand:
        return "gate"
    for fam in FAMILIES:
        if any(k.startswith(fam) for k in cand if k != "name"):
            return fam
    return None


def thresholds(cand: dict) -> dict[int, float]:
    if "thr_abs" in cand:
        # 문턱값을 직접 줌 (킥·스네어·탐·하이햇·심벌 순서, LABELS와 같음). 탐은 rules의 tom_threshold로 따로 줌
        return dict(zip(LABELS, (float(v) for v in cand["thr_abs"]), strict=True))
    m, c = cand.get("thr_m", 1.0), cand.get("thr_c", 1.0)
    return {k: v * (c if k == 49 else 1.0 if k == 47 else m) for k, v in BASE_THR.items()}


def repick(act: np.ndarray, peaks: dict[int, list[float]], cand: dict) -> dict[int, list[float]]:
    """킥·스네어·하이햇·심벌 피크를 후보 문턱값으로 다시 고름. 탐은 서비스 규칙이 따로 고르므로 그대로."""
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import pick_peaks

    if not any(k in cand for k in ("thr_m", "thr_c", "thr_abs", "co_r")):
        return peaks
    thr = thresholds(cand)
    out = {k: list(v) for k, v in peaks.items()}
    for col, lab in enumerate(LABELS):
        if lab != 47:
            out[lab] = pick_peaks(act[:, col], thr[lab], fps=FPS)
    r = cand.get("co_r")
    if r:
        base = {lab: np.asarray(out.get(lab, []), dtype=np.float64) for lab in LABELS}
        for col, lab in enumerate(LABELS):
            if lab == 47:
                continue
            others = np.concatenate([base[o] for o in LABELS if o != lab])
            have = base[lab]
            extra = [
                t
                for t in pick_peaks(act[:, col], thr[lab] * r, fps=FPS)
                if (len(others) and np.min(np.abs(others - t)) <= NEAR_SEC)
                and not (len(have) and np.min(np.abs(have - t)) <= NEAR_SEC)
            ]
            out[lab] = sorted([*have.tolist(), *extra])
    return out


def rules_for(base: dict, cand: dict) -> dict:
    """후보의 rules 칸(서비스 규칙 값 바꾸기)을 서비스 규칙에 덮어씀."""
    return {**base, **cand.get("rules", {})}


def _window_max(col: np.ndarray, t: float) -> float:
    i = int(round(t * FPS))
    k = int(round(NEAR_SEC * FPS))
    seg = col[max(0, i - k) : i + k + 1]
    return float(seg.max()) if len(seg) else 0.0


def relabel(hits: np.ndarray, act: np.ndarray, cand: dict) -> np.ndarray:
    """규칙이 낸 탐·하이햇 타격 중 스네어 점수가 충분하고 근처에 스네어 타격이 없는 것을 스네어로 바꿈."""
    out = hits.copy()
    sn = act[:, LABELS.index(38)]
    for fam, pads, src in (("tom2sn", TOMS, 47), ("hh2sn", ("HIHAT",), 42)):
        s = cand.get(fam)
        if not s:
            continue
        col = act[:, LABELS.index(src)]
        sn_times = out["time_sec"][out["pad"] == "SNARE"]
        for i in np.flatnonzero(np.isin(out["pad"], pads)):
            t = float(out["time_sec"][i])
            if len(sn_times) and np.min(np.abs(sn_times - t)) <= NEAR_SEC:
                continue
            if _window_max(sn, t) >= s * max(_window_max(col, t), 1e-6):
                out["pad"][i] = "SNARE"
    return out


def _stem_energy(x: np.ndarray, sr: int, t: float) -> float:
    seg = x[max(0, int((t - 0.01) * sr)) : int((t + 0.04) * sr)].astype(np.float64)
    return float(np.mean(seg**2)) if len(seg) else 0.0


def kick_to_tom(hits: np.ndarray, f, rules: dict, act: np.ndarray, cand: dict) -> np.ndarray:
    """킥 타격 중 DrumSep 탐 트랙이 킥 트랙보다 충분히 큰 것을 탐으로 바꿈 (11/08 실제 곡 탐 검출).

    log10(탐 에너지 / 킥 에너지) > k2t 이고, ADTOF 탐 점수가 k2t_tom_max 아래이고(탐을 이미 따로 잡은 동시 타격은 둠),
    50ms 안에 예측 탐이 없을 때만 바꿈. 이름은 k2t_name이 pitch면 그 시각 탐 음높이에 가장 가까운 곡 안 탐 묶음 이름,
    floor면 FLOOR_TOM.
    """
    th = cand.get("k2t")
    if th is None:
        return hits
    from ssaplash_ai.bench.analysis.rule_eval import tom_summary
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import tom_f0_at

    kick, toms = f.stems.get("kick"), f.stems.get("toms")
    if kick is None or toms is None:
        return hits
    kick, toms_1d = kick[0], toms[0]
    sr = f.sample_rate
    out = hits.copy()
    tom_t = out["time_sec"][np.isin(out["pad"], TOMS)]
    tom_col = act[:, LABELS.index(47)]
    tom_max = cand.get("k2t_tom_max", 0.3)
    by_pitch = cand.get("k2t_name", "pitch") == "pitch"
    medians: list[float] = []
    names: list[str] = []
    if by_pitch:
        ts = tom_summary(f, rules)
        medians, names = list(ts.cluster_medians), list(ts.cluster_names)
    for i in np.flatnonzero(out["pad"] == "KICK"):
        t = float(out["time_sec"][i])
        lr = np.log10((_stem_energy(toms_1d, sr, t) + 1e-12) / (_stem_energy(kick, sr, t) + 1e-12))
        if lr <= th or _window_max(tom_col, t) >= tom_max:
            continue
        if len(tom_t) and np.min(np.abs(tom_t - t)) <= 0.05:
            continue
        name = "FLOOR_TOM"
        if medians:
            hz = tom_f0_at(toms, sr, t, rules)
            if np.isfinite(hz) and hz > 0:
                j = int(np.argmin([abs(np.log2(hz / m)) for m in medians]))
                name = names[j]
        out["pad"][i] = name
    return out


def crash_refractory(hits: np.ndarray, cand: dict) -> np.ndarray:
    """크래시 뒤 cref초 안의 크래시를 라이드로 바꿈 (Riley·Dixon 2024 LBD의 크래시 재발생 막기).

    크래시는 한 번 치면 길게 울려 바로 다시 치는 일이 드물다는 가정. 앞 크래시는 바뀌지 않은 크래시만 셈.
    """
    r = cand.get("cref")
    if not r:
        return hits
    out = hits.copy()
    last = -np.inf
    for i in np.argsort(out["time_sec"], kind="stable"):
        if out["pad"][i] != "CRASH":
            continue
        t = float(out["time_sec"][i])
        if t - last < r:
            out["pad"][i] = "RIDE"
        else:
            last = t
    return out


# ---------- 채점 ----------


def _init(dataset_yaml: str, features: str, enst_c1_ride: bool, cands: list[dict]) -> None:
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
        cands=cands,
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
    act = np.asarray(f.activations, dtype=np.float32)
    peaks0 = {int(k): list(v) for k, v in f.peaks.items()}
    rows = []
    for cand in _S["cands"]:
        f.peaks = {k: np.asarray(v, dtype=np.float64) for k, v in repick(act, peaks0, cand).items()}
        rules = rules_for(_S["rules"], cand)
        pred = kick_to_tom(relabel(predict_hits(f, rules), act, cand), f, rules, act, cand)
        pred = crash_refractory(pred, cand)
        s = score_hits(truth, pred, "pads")
        row = {"candidate": cand["name"], "songId": song_id}
        for p in SCORED:
            c = s.by_label.get(p)
            row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (c.tp, c.fp, c.fn) if c else (0, 0, 0)
        rows.append(row)
    return rows


def cmd_run(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    cands = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    songs = load_dataset(DatasetConfig.from_yaml(args.dataset)).song_ids()
    print(f"[postproc] 곡 {len(songs)}개 × 후보 {len(cands)}개", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    init = (args.dataset, args.features, args.enst_c1_ride, cands)
    with (
        open(args.out, "w", newline="", encoding="utf-8") as fh,
        Pool(args.workers, _init, init) as pool,
    ):
        w = None
        for i, rows in enumerate(pool.imap_unordered(song_rows, songs, chunksize=2), 1):
            if w is None:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), lineterminator="\n")
                w.writeheader()
            w.writerows(rows)
            if i % 100 == 0 or i == len(songs):
                print(f"[postproc] {i}/{len(songs)}곡 ({time.time() - t0:.0f}초)", flush=True)
    print(f"[postproc] 저장 {args.out}", flush=True)
    return 0


# ---------- 고르기·ENST ----------


def f1_of(df, pads=SCORED) -> float:
    tp = sum(df[f"tp{p}"].sum() for p in pads)
    fp = sum(df[f"fp{p}"].sum() for p in pads)
    fn = sum(df[f"fn{p}"].sum() for p in pads)
    return 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else float("nan")


def scores(csv_path: Path) -> dict[str, float]:
    import pandas as pd

    d = pd.read_csv(csv_path)
    return {name: f1_of(g) for name, g in d.groupby("candidate")}


def choose(
    mdb: dict[str, float], egmd: dict[str, float], cands: list[dict], egmd_drop: float = 0.005
):
    """후보 묶음마다 MDB 8패드가 가장 높은 후보. MDB가 current보다 높고 E-GMD가 egmd_drop 넘게 안 떨어진 것만."""
    base_m, base_e = mdb["current"], egmd["current"]
    picked = {}
    for fam in FAMILIES:
        ok = [
            c
            for c in cands
            if family(c) == fam
            and mdb.get(c["name"], -1) > base_m
            and egmd.get(c["name"], -1) >= base_e - egmd_drop
        ]
        if ok:
            best = max(ok, key=lambda c: (round(mdb[c["name"]], 6), egmd[c["name"]]))
            picked[fam] = best
    return picked


def combos(picked: dict[str, dict], mdb: dict[str, float]) -> list[dict]:
    """고른 후보를 MDB 상승이 큰 순서로 하나씩 더한 조합들 (둘 이상일 때만)."""
    order = sorted(picked.values(), key=lambda c: -mdb[c["name"]])
    out, acc = [], {}
    for i, c in enumerate(order):
        acc.update({k: v for k, v in c.items() if k != "name"})
        if i >= 1:
            out.append({"name": "combo_" + "+".join(x["name"] for x in order[: i + 1]), **acc})
    return out


def cmd_select(args: argparse.Namespace) -> int:
    cands = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    mdb, egmd = scores(args.mdb), scores(args.egmd)
    picked = choose(mdb, egmd, cands)
    table = [
        {"candidate": c["name"], "family": family(c), "mdb": round(mdb.get(c["name"], float("nan")), 4),
         "egmd": round(egmd.get(c["name"], float("nan")), 4)}
        for c in cands if c["name"] in mdb
    ]  # fmt: skip
    out = {
        "rule": "후보 묶음마다 MDB 8패드 최고, MDB > current, E-GMD ≥ current − 0.005",
        "current": {"mdb": mdb["current"], "egmd": egmd["current"]},
        "picked": picked,
        "combos": combos(picked, mdb),
        "table": table,
    }
    if args.final:
        ok = [
            n
            for n in mdb
            if n != "current"
            and mdb[n] > mdb["current"]
            and egmd.get(n, -1) >= egmd["current"] - 0.005
        ]
        out["final"] = max(ok, key=lambda n: mdb[n]) if ok else None
    Path(args.out).write_text(
        json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n"
    )
    print(json.dumps({k: out[k] for k in out if k != "table"}, ensure_ascii=False, indent=1))
    return 0


def bootstrap(df, names: list[str], pads=SCORED, n: int = 2000, seed: int = 0) -> dict[str, tuple]:
    """current 대비 F1 차이와 곡을 다시 뽑은 95% 구간."""
    rng = np.random.default_rng(seed)
    songs = sorted(df.songId.unique())
    idx = {s: i for i, s in enumerate(songs)}
    cols = [f"{k}{p}" for p in pads for k in ("tp", "fp", "fn")]

    def mat(name):
        g = df[df.candidate == name].set_index("songId").reindex(songs)[cols].fillna(0).to_numpy()
        tp = g[:, 0::3].sum(1)
        return np.stack([tp, g[:, 1::3].sum(1), g[:, 2::3].sum(1)], 1)

    def f1(m):
        tp, fp, fn = m[..., 0], m[..., 1], m[..., 2]
        return 2 * tp / np.maximum(2 * tp + fp + fn, 1)

    base = mat("current")
    draws = rng.integers(0, len(songs), size=(n, len(songs)))
    out = {}
    for name in names:
        m = mat(name)
        diff = f1(m.sum(0)) - f1(base.sum(0))
        boot = f1(m[draws].sum(1)) - f1(base[draws].sum(1))
        out[name] = (float(diff), float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5)))
    del idx
    return out


def cmd_enst(args: argparse.Namespace) -> int:
    import pandas as pd

    lines = [
        "| 입력 | 묶음 | 후보 | 8패드 F1 | 차이 (95% 구간) |",
        "| --- | --- | --- | --- | --- |",
    ]
    pad_lines = [
        "| 입력 | 후보 | " + " | ".join(SCORED) + " |",
        "| --- | --- | " + " | ".join("---" for _ in SCORED) + " |",
    ]
    for label, path in (("드럼 단독", args.drums), ("원곡 분리", args.sep)):
        d = pd.read_csv(path)
        d["grp"] = np.where(d.songId.str.startswith("drummer_1"), "드러머 1", "드러머 2·3")
        names = [c for c in d.candidate.unique() if c != "current"]
        for grp_name, g in [("전체", d), *list(d.groupby("grp"))]:
            bs = bootstrap(g, names)
            lines.append(
                f"| {label} | {grp_name} | current | {f1_of(g[g.candidate == 'current']):.3f} | |"
            )
            for nm in names:
                diff, lo, hi = bs[nm]
                lines.append(
                    f"| {label} | {grp_name} | {nm} | {f1_of(g[g.candidate == nm]):.3f} | {diff:+.3f} ({lo:+.3f} ~ {hi:+.3f}) |"
                )
        for nm in ["current", *names]:
            g = d[d.candidate == nm]
            pad_lines.append(
                f"| {label} | {nm} | " + " | ".join(f"{f1_of(g, (p,)):.3f}" for p in SCORED) + " |"
            )
    text = "\n".join(lines) + "\n\n패드별 F1\n\n" + "\n".join(pad_lines) + "\n"
    Path(args.out).write_text(text, encoding="utf-8", newline="\n")
    print(text)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="command", required=True)
    g = sub.add_parser("grid")
    g.add_argument("--out", required=True, type=Path)
    r = sub.add_parser("run")
    r.add_argument("--dataset", required=True)
    r.add_argument("--features", default="data/rule_features")
    r.add_argument("--candidates", required=True)
    r.add_argument(
        "--enst-c1-ride", action="store_true", help="ENST c1·c4를 RIDE로 채점 (11/06 결정)"
    )
    r.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    r.add_argument("--out", required=True, type=Path)
    s = sub.add_parser("select")
    s.add_argument("--mdb", required=True, type=Path)
    s.add_argument("--egmd", required=True, type=Path)
    s.add_argument("--candidates", required=True)
    s.add_argument("--final", action="store_true", help="모든 후보 중 하나를 마지막으로 고름")
    s.add_argument("--out", required=True)
    e = sub.add_parser("enst")
    e.add_argument("--drums", required=True, type=Path)
    e.add_argument("--sep", required=True, type=Path)
    e.add_argument("--out", required=True)
    args = ap.parse_args()
    if args.command == "grid":
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(grid(), indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"후보 {len(grid())}개 → {args.out}")
        return 0
    return {"run": cmd_run, "select": cmd_select, "enst": cmd_enst}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
