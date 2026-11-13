"""실제 녹음 학습 확인 실험 채점표 (설계 CHART-003-real-drum-data-check 3-4·4-5절).

드러머 하나·MDB 묶음 하나를 빼고 학습한 모델 셋의 rule-eval `by_song.csv`에서, 학습마다 안 본 곡
(ENST 그 드러머의 반주 곡·MDB 그 묶음)만 골라 합침. 합친 결과는 ENST 64곡·MDB 23곡 전부를 학습에
안 쓴 모델로 채점한 것과 같음. 모든 곡을 안 본 비교 모델(기본 가중치·tom_6cls·tom_6cls_plain)은 같은
곡 목록으로 나란히 놓음. 점수는 곡별 tp·fp·fn을 더해 계산(rule-eval과 같음)하고, 기준 모델과의 차이에
곡 단위로 다시 뽑은 95% 구간을 붙임. 끝에 설계 4-5절 판정 줄.

  uv run python scripts/score_heldout.py \\
      --run tom_6cls_real_no_d1=data/results/real_check/rule-eval-tom_6cls_real_no_d1 \\
      --run tom_6cls_real_no_d2=data/results/real_check/rule-eval-tom_6cls_real_no_d2 \\
      --run tom_6cls_real_no_d3=data/results/real_check/rule-eval-tom_6cls_real_no_d3 \\
      --compare base=data/results/finetune_results_new/rule-eval-base-pedal \\
      --compare tom_6cls=data/results/finetune_results_new/rule-eval-ft-tom_6cls \\
      --compare tom_6cls_plain=data/results/real_check/rule-eval-tom_6cls_plain \\
      --folds configs/train/real_check/folds.yaml --out data/results/real_check/heldout.md
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
import yaml

N_BOOT = 1000
TOM_PADS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
ENST = "enst_minus_one"
MDB = "mdb_drums"
REAL_DATASETS = (ENST, MDB)
# 곡별로 모으는 값. tom·pedal은 [tp, fp, fn], false는 rule-eval tomFalseKept(정답에 없는 탐)
KEYS = ("tom", "pedal", "false")
# 판정 기준
H_GAIN, H_NOT, FALSE_RATIO, GUARD_DROP, PEDAL_PREC = 0.10, 0.05, 0.5, 0.02, 0.6

# {데이터셋: {곡: {키: [a, b, c]}}}
Songs = dict[str, dict[str, dict[str, list[int]]]]


def read_by_song(folder: Path, candidate: str) -> Songs:
    out: Songs = {}
    found = False
    with (folder / "by_song.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["candidate"] != candidate:
                continue
            found = True
            tom = [sum(int(r[f"{m}{p}"]) for p in TOM_PADS) for m in ("tp", "fp", "fn")]
            pedal = [int(r.get(f"{m}HIHAT_PEDAL9") or 0) for m in ("tp", "fp", "fn")]
            false = [int(r["tomFalseKept"]), 0, 0]
            out.setdefault(r["dataset"], {})[r["songId"]] = {
                "tom": tom,
                "pedal": pedal,
                "false": false,
            }
    if not found:
        raise ValueError(f"{folder}/by_song.csv에 후보 {candidate} 줄이 없음")
    return out


def drummer_of(song: str) -> int | None:
    """ENST 곡 id `drummer_1/107_…` → 1."""
    head = song.split("/", 1)[0]
    return int(head[len("drummer_") :]) if head.startswith("drummer_") else None


def held_out(fold: int, dataset: str, song: str, mdb_folds: dict[int, list[str]]) -> bool:
    if dataset == ENST:
        return drummer_of(song) == fold
    if dataset == MDB:
        return song in mdb_folds[fold]
    return False


def combine_runs(runs: dict[str, Songs], folds: dict) -> Songs:
    """학습마다 안 본 곡만 모아 하나로. 같은 곡이 두 학습에서 나오면 오류."""
    mdb_folds = {int(k): list(v) for k, v in folds["mdb_folds"].items()}
    fold_of = {str(k): int(v) for k, v in folds["runs"].items()}
    out: Songs = {}
    for name, songs in runs.items():
        if name not in fold_of:
            raise ValueError(f"묶음 표에 학습 {name}이 없음 (있는 것: {sorted(fold_of)})")
        for ds in REAL_DATASETS:
            for song, counts in songs.get(ds, {}).items():
                if not held_out(fold_of[name], ds, song, mdb_folds):
                    continue
                if song in out.setdefault(ds, {}):
                    raise ValueError(f"{ds} {song}이 두 학습에서 안 본 곡으로 나옴")
                out[ds][song] = counts
    return out


def f1(tp: float, fp: float, fn: float) -> float:
    return 2 * tp / (2 * tp + fp + fn) if tp > 0 else 0.0


def prec(tp: float, fp: float) -> float:
    return tp / (tp + fp) if tp + fp > 0 else 0.0


def totals(songs: dict[str, dict[str, list[int]]], key: str, order: list[str]) -> np.ndarray:
    return np.array([songs[s][key] for s in order], dtype=np.float64).reshape(len(order), 3)


def boot_diff(a: np.ndarray, b: np.ndarray, rng: np.random.Generator) -> tuple[float, float]:
    """곡별 [tp, fp, fn] 행렬 둘(같은 곡 순서)의 F1 차이 a − b의 95% 구간."""
    n = len(a)
    if n == 0:
        return float("nan"), float("nan")
    diffs = np.empty(N_BOOT)
    for i in range(N_BOOT):
        idx = rng.integers(0, n, n)
        diffs[i] = f1(*a[idx].sum(0)) - f1(*b[idx].sum(0))
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return float(lo), float(hi)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", action="append", default=[], help="학습이름=rule-eval 폴더 (묶음별)")
    ap.add_argument(
        "--compare", action="append", default=[], help="이름=rule-eval 폴더 (모든 곡을 안 본 모델)"
    )
    ap.add_argument("--folds", type=Path, required=True)
    ap.add_argument("--candidate", default="pk_gap30")
    ap.add_argument("--name", default="real_heldout", help="합친 결과의 이름")
    ap.add_argument("--ref", default="tom_6cls", help="H1·H2 비교 기준")
    ap.add_argument("--base", default="base", help="개선 판정 기준인 ADTOF 원래 가중치")
    ap.add_argument("--plain", default="tom_6cls_plain", help="H2 설정 대조")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    def pairs(items: list[str]) -> dict[str, Path]:
        out = {}
        for item in items:
            name, _, path = item.partition("=")
            if not path:
                raise SystemExit(f"이름=폴더 형식이 아님: {item}")
            out[name] = Path(path)
        return out

    runs = {n: read_by_song(p, args.candidate) for n, p in pairs(args.run).items()}
    compares = {n: read_by_song(p, args.candidate) for n, p in pairs(args.compare).items()}
    folds = yaml.safe_load(args.folds.read_text(encoding="utf-8"))
    combined = combine_runs(runs, folds) if runs else {}
    models: dict[str, Songs] = {**({args.name: combined} if runs else {}), **compares}
    if not models:
        raise SystemExit("--run이나 --compare가 하나는 있어야 함")

    lines = [
        f"# 실제 녹음 학습 확인 채점표 (후보 {args.candidate})",
        "",
        f"`{args.name}`은 학습 {len(runs)}개에서 각자 안 본 곡만 모은 것. 비교 모델은 같은 곡 목록으로 자름.",
        "",
    ]
    rng = np.random.default_rng(0)
    real: dict[tuple[str, str], dict[str, float]] = {}
    for ds in REAL_DATASETS:
        order = sorted(set.intersection(*(set(m.get(ds, {})) for m in models.values())))
        missing = {n: sorted(set(m.get(ds, {})) - set(order)) for n, m in models.items()}
        lines += [f"## {ds} ({len(order)}곡)", ""]
        if any(missing.values()):
            lines += [
                "곡 목록이 달라 빠진 곡: "
                + ", ".join(f"{n} {len(v)}곡" for n, v in missing.items() if v),
                "",
            ]
        lines += [
            "| 모델 | 탐 3종 F1 | tp / fp / fn | 정답에 없는 탐 | 페달 정밀도 | 페달 재현율 | 페달 F1 |"
            + f" {args.ref} 대비 탐 F1 차이 (95%) |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        ref_tom = totals(models[args.ref][ds], "tom", order) if args.ref in models else None
        for name, m in models.items():
            tom = totals(m[ds], "tom", order)
            ped = totals(m[ds], "pedal", order)
            fk = totals(m[ds], "false", order)[:, 0].sum()
            t, p = tom.sum(0), ped.sum(0)
            row = {
                "f1": f1(*t),
                "false": fk,
                "pedal_prec": prec(p[0], p[1]),
                "pedal_f1": f1(*p),
            }
            diff = ""
            if ref_tom is not None and name != args.ref:
                lo, hi = boot_diff(tom, ref_tom, rng)
                row["diff"] = row["f1"] - f1(*ref_tom.sum(0))
                row["lo"], row["hi"] = lo, hi
                diff = f"{row['diff']:+.3f} ({lo:+.3f} ~ {hi:+.3f})"
            real[(name, ds)] = row
            lines.append(
                f"| {name} | {row['f1']:.3f} | {t[0]:.0f} / {t[1]:.0f} / {t[2]:.0f} | {fk:.0f} | "
                f"{row['pedal_prec']:.3f} | {prec(p[0], p[2]):.3f} | {row['pedal_f1']:.3f} | {diff} |"
            )
        lines.append("")
        if ds == ENST:
            lines += [
                "드러머별 탐 3종 F1 / 정답에 없는 탐:",
                "",
                "| 모델 | " + " | ".join(f"drummer_{d}" for d in (1, 2, 3)) + " |",
                "| --- | --- | --- | --- |",
            ]
            for name, m in models.items():
                cells = []
                for d in (1, 2, 3):
                    sub = [s for s in order if drummer_of(s) == d]
                    t = totals(m[ds], "tom", sub).sum(0)
                    fk = totals(m[ds], "false", sub)[:, 0].sum()
                    real[(name, f"{ds}_d{d}")] = {"f1": f1(*t), "false": fk}
                    cells.append(f"{f1(*t):.3f} / {fk:.0f}")
                lines.append(f"| {name} | " + " | ".join(cells) + " |")
            lines.append("")

    # 합성 데이터: 학습마다 따로 (모든 곡을 안 봄)
    synth = sorted(
        {ds for s in (*runs.values(), *compares.values()) for ds in s} - set(REAL_DATASETS)
    )
    synth_f1: dict[tuple[str, str], float] = {}
    if synth:
        lines += [
            "## 합성 데이터 탐 3종 F1 (학습마다 따로)",
            "",
            "| 모델 | " + " | ".join(synth) + " |",
            "| --- |" + " --- |" * len(synth),
        ]
        for name, s in {**runs, **compares}.items():
            cells = []
            for ds in synth:
                if ds in s:
                    t = totals(s[ds], "tom", sorted(s[ds])).sum(0)
                    synth_f1[(name, ds)] = f1(*t)
                    cells.append(f"{f1(*t):.3f}")
                else:
                    cells.append("-")
            lines.append(f"| {name} | " + " | ".join(cells) + " |")
        lines.append("")

    lines += ["## 판정 (설계 4-5절)", ""]
    lines += judge(args, runs, real, synth_f1)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"[score-heldout] 결과 → {args.out}")
    return 0


def judge(
    args: argparse.Namespace,
    runs: dict[str, Songs],
    real: dict[tuple[str, str], dict[str, float]],
    synth_f1: dict[tuple[str, str], float],
) -> list[str]:
    out: list[str] = []
    ref, name = args.ref, args.name

    def get(model: str, ds: str) -> dict[str, float] | None:
        return real.get((model, ds))

    def verdict(row: dict[str, float]) -> str:
        if row["diff"] < H_NOT or row["lo"] <= 0:
            return "아님"
        return "맞음" if row["diff"] > H_GAIN else "애매"

    r_enst, f_enst = get(name, ENST), get(ref, ENST)
    if runs and r_enst and f_enst and "diff" in r_enst:
        v = verdict(r_enst)
        d1, d1_ref = get(name, f"{ENST}_d1"), get(ref, f"{ENST}_d1")
        false_ok = (
            d1 is not None and d1_ref is not None and d1["false"] < FALSE_RATIO * d1_ref["false"]
        )
        if v == "맞음" and not false_ok:
            v = "애매"
        out.append(
            f"- H1(실제 녹음 데이터): {v}. ENST 탐 3종 F1 {f_enst['f1']:.3f} → {r_enst['f1']:.3f} "
            f"({r_enst['diff']:+.3f}, 95% {r_enst['lo']:+.3f} ~ {r_enst['hi']:+.3f}), drummer_1 정답에 없는 탐 "
            f"{d1_ref['false'] if d1_ref else float('nan'):.0f} → {d1['false'] if d1 else float('nan'):.0f}"
            f" (기준: +{H_GAIN} 넘게, 절반 아래)"
        )
        base_enst, r_mdb, f_mdb = get(args.base, ENST), get(name, MDB), get(ref, MDB)
        checks = []
        if base_enst:
            checks.append(
                (
                    f"ENST {r_enst['f1']:.3f} ≥ {args.base} {base_enst['f1']:.3f}",
                    r_enst["f1"] >= base_enst["f1"],
                )
            )
        if r_mdb and f_mdb:
            checks.append(
                (f"MDB {r_mdb['f1']:.3f} ≥ {ref} {f_mdb['f1']:.3f}", r_mdb["f1"] >= f_mdb["f1"])
            )
        for ds in sorted({d for (_, d) in synth_f1}):
            if (ref, ds) not in synth_f1:
                continue
            worst = min((synth_f1[(r, ds)] for r in runs if (r, ds) in synth_f1), default=None)
            if worst is not None:
                ok = worst >= synth_f1[(ref, ds)] - GUARD_DROP
                checks.append(
                    (f"{ds} 최저 {worst:.3f} ≥ {ref} {synth_f1[(ref, ds)]:.3f} − {GUARD_DROP}", ok)
                )
        if checks:
            ok = v == "맞음" and all(c for _, c in checks)
            out.append(
                f"- 서비스 개선 가능: {'예' if ok else '아니오'}. "
                + ", ".join(f"{t} {'통과' if c else '미달'}" for t, c in checks)
            )
        if r_mdb and f_mdb:
            ok = r_mdb["pedal_prec"] >= PEDAL_PREC and r_mdb["pedal_f1"] > f_mdb["pedal_f1"]
            out.append(
                f"- H1 페달: {'맞음' if ok else '아님'}. MDB 페달 정밀도 {r_mdb['pedal_prec']:.3f} "
                f"(기준 {PEDAL_PREC} 이상), 페달 F1 {f_mdb['pedal_f1']:.3f} → {r_mdb['pedal_f1']:.3f}"
            )
    p_enst = get(args.plain, ENST)
    if p_enst and f_enst and "diff" in p_enst:
        out.append(
            f"- H2(학습 설정): {verdict(p_enst)}. ENST 탐 3종 F1 {f_enst['f1']:.3f} → {p_enst['f1']:.3f} "
            f"({p_enst['diff']:+.3f}, 95% {p_enst['lo']:+.3f} ~ {p_enst['hi']:+.3f})"
        )
    return out or ["- 판정할 모델이 모자람 (--run 셋과 --compare 기준·설정 대조가 필요)"]


if __name__ == "__main__":
    raise SystemExit(main())
