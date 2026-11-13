"""크래시·라이드 비교표 (S15P31A307-164 설계 v0.3 4-8절).

rule-eval 결과 폴더의 candidates.csv(패드별 F1·심벌 검출 개수), confusion.csv(심벌 혼동), by_song.csv(곡별
크래시·라이드 개수)를 읽어 방식마다 같은 기준으로 셈. 50ms.
- 크래시·라이드 F1: 둘 각각과, 둘의 개수를 더해 계산한 F1(곡 단위로 2,000번 다시 뽑은 95% 구간)
- 심벌 검출 F1: 크래시인지 라이드인지 무시하고 심벌을 쳤는지만
- 크래시→라이드, 라이드→크래시: 시각은 맞았는데 이름을 바꿔 붙인 수
채택 기준: MDB·ENST 크래시·라이드 평균 F1이 기준 방식(--baseline)보다 오르고, 다섯 데이터 어디서도
크래시·라이드 평균·심벌 검출·킥·스네어·하이햇·탐 3종 F1이 0.02 넘게 떨어지지 않음.

  uv run python scripts/score_cymbal.py \\
      --rule-eval now=data/results/rule-eval-base-cymbal@pk_gap30 \\
      --rule-eval cw150=data/results/rule-eval-base-cymbal@cw150 \\
      --rule-eval tom_7cls=data/results/rule-eval-ft-tom_7cls@pk_gap30 \\
      --baseline now --out data/results/cymbal-compare.md
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path

import numpy as np

N_BOOT = 2000
REAL_DATASETS = ("mdb_drums", "enst_minus_one")
GUARD_COLS = ("f1KICK", "f1SNARE", "f1HIHAT", "f1Tom")
MAX_DROP = 0.02


def f1(tp: float, fp: float, fn: float) -> float:
    d = 2 * tp + fp + fn
    return 2 * tp / d if d else float("nan")


def read(name: str, folder: Path, cand: str) -> tuple[dict, dict]:
    """(데이터셋 → 지표 dict, 데이터셋 → 곡별 [tp, fp, fn] 행렬)."""
    metrics: dict[str, dict[str, float]] = {}
    with (folder / "candidates.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["candidate"] != cand:
                continue
            m = {k: float(r[k]) for k in ("f1CRASH", "f1RIDE", *GUARD_COLS)}
            matched, kept, missed = (
                float(r[k]) for k in ("cymbalMatched", "cymbalFalseKept", "cymbalMissed")
            )
            m["cymDetect"] = f1(matched, kept, missed)
            m["c2r"] = m["r2c"] = 0.0
            metrics[r["dataset"]] = m
    if not metrics:
        raise ValueError(f"{folder / 'candidates.csv'}에 후보 {cand}가 없음 ({name})")
    with (folder / "confusion.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["candidate"] != cand or r["group"] != "cymbal" or r["dataset"] not in metrics:
                continue
            if (r["truePad"], r["predPad"]) == ("CRASH", "RIDE"):
                metrics[r["dataset"]]["c2r"] = float(r["count"])
            elif (r["truePad"], r["predPad"]) == ("RIDE", "CRASH"):
                metrics[r["dataset"]]["r2c"] = float(r["count"])
    songs: dict[str, dict[str, list[int]]] = defaultdict(dict)
    with (folder / "by_song.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["candidate"] != cand:
                continue
            songs[r["dataset"]][r["songId"]] = [
                int(r[f"{k}CRASH"]) + int(r[f"{k}RIDE"]) for k in ("tp", "fp", "fn")
            ]
    return metrics, songs


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--rule-eval", action="append", default=[], help="이름=rule-eval 폴더@후보")
    p.add_argument("--baseline", required=True, help="비교 기준 방식 이름")
    p.add_argument("--out", type=Path, default=None, help="표를 쓸 md 파일 (없으면 화면만)")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    data: dict[str, tuple[dict, dict]] = {}
    for spec in args.rule_eval:
        name, folder = spec.split("=", 1)
        folder, _, cand = folder.partition("@")
        if not cand:
            raise ValueError(f"--rule-eval {spec}: 이름=폴더@후보 형식이어야 함")
        data[name] = read(name, Path(folder), cand)
    if args.baseline not in data:
        raise ValueError(f"--baseline {args.baseline}이 --rule-eval 이름에 없음")
    names = list(data)
    datasets = sorted({ds for m, _ in data.values() for ds in m})
    rng = np.random.default_rng(args.seed)
    lines = ["# 크래시·라이드 비교", ""]

    for ds in datasets:
        present = [n for n in names if ds in data[n][0]]
        common = sorted(set.intersection(*(set(data[n][1][ds]) for n in present)))
        idx = rng.integers(0, len(common), size=(N_BOOT, len(common)))
        lines += [f"## {ds} (곡 {len(common)}개, 50ms)", ""]
        head = [
            "방식",
            "크래시 F1",
            "라이드 F1",
            "둘 합산 F1 (95% 구간)",
            "심벌 검출 F1",
            "크래시→라이드",
            "라이드→크래시",
            "킥",
            "스네어",
            "하이햇",
            "탐 3종",
        ]
        lines += ["| " + " | ".join(head) + " |", "|" + " --- |" * len(head)]
        for n in present:
            m = data[n][0][ds]
            mat = np.array([data[n][1][ds][s] for s in common], dtype=float).reshape(-1, 3)
            s = mat[idx].sum(axis=1)
            d = 2 * s[:, 0] + s[:, 1] + s[:, 2]
            with np.errstate(invalid="ignore", divide="ignore"):
                boot = np.where(d > 0, 2 * s[:, 0] / d, np.nan)
            lo, hi = np.nanpercentile(boot, [2.5, 97.5])
            lines.append(
                f"| {n} | {m['f1CRASH']:.3f} | {m['f1RIDE']:.3f} | "
                f"{f1(*mat.sum(axis=0)):.3f} ({lo:.2f}~{hi:.2f}) | {m['cymDetect']:.3f} | "
                f"{int(m['c2r'])} | {int(m['r2c'])} | "
                + " | ".join(f"{m[c]:.3f}" for c in GUARD_COLS)
                + " |"
            )
        lines += ["", "둘 합산 F1의 괄호는 곡 단위로 다시 뽑아 2,000번 계산한 95% 구간.", ""]

    lines += ["## 채택 판정 (설계 U28)", ""]
    base = data[args.baseline][0]
    for n in names:
        if n == args.baseline:
            continue
        m_all = data[n][0]
        reasons = []

        def mean_cr(m: dict) -> float:
            return (m["f1CRASH"] + m["f1RIDE"]) / 2

        for ds in REAL_DATASETS:
            if ds not in m_all or ds not in base:
                reasons.append(f"{ds} 결과 없음")
            elif not mean_cr(m_all[ds]) > mean_cr(base[ds]):
                reasons.append(
                    f"{ds} 크래시·라이드 평균 {mean_cr(m_all[ds]):.3f} ≤ 기준 {mean_cr(base[ds]):.3f}"
                )
        for ds, m in m_all.items():
            if ds not in base:
                continue
            b = base[ds]
            checks = {
                "크래시·라이드 평균": (mean_cr(m), mean_cr(b)),
                "심벌 검출": (m["cymDetect"], b["cymDetect"]),
            }
            checks.update({c[2:]: (m[c], b[c]) for c in GUARD_COLS})
            for label, (v, bv) in checks.items():
                if bv - v > MAX_DROP:
                    reasons.append(f"{ds} {label} {bv - v:.3f} 떨어짐")
        verdict = "채택 가능" if not reasons else "기준 못 넘음: " + ", ".join(reasons)
        lines.append(f"- {n}: {verdict}")

    text = "\n".join(lines)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n", encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
