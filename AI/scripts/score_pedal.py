"""페달 하이햇 HIHAT_PEDAL 비교표 (S15P31A307-164 설계 v0.2 4-7절).

run-transcription 결과 폴더는 hits_by_class.csv의 pads9 기준 행(HIHAT_PEDAL·HIHAT, 혼동 수 PEDAL_AS_HIHAT·
HIHAT_AS_PEDAL)과 pads 기준 HIHAT(페달을 합친 하이햇)을, rule-eval 결과 폴더는 by_song.csv의
tpHIHAT_PEDAL9 등 열과 tpHIHAT(합친 하이햇)을 곡별로 읽어 같은 기준으로 셈. 50ms.
점수는 묶음 안 모든 곡의 개수를 더해 계산하고, 곡 단위로 2,000번 다시 뽑은 95% 구간을 붙임.
채택 기준: MDB·GMD test 둘 다 페달 F1 0.5 이상·정밀도 0.6 이상, 하이햇+페달 F1이
기준 방식(--baseline)보다 어느 데이터에서도 0.02 넘게 떨어지지 않음.

  uv run python scripts/score_pedal.py \\
      --rule-eval base=data/results/rule-eval-base-pedal@pk_gap30 \\
      --rule-eval tom_6cls=data/results/rule-eval-ft-tom_6cls@pk_gap30 \\
      --run d2m_learned=data/results/d2m-learned-mdb --run d2m_learned=data/results/d2m-learned-gmd \\
      --baseline base --out data/results/pedal-compare.md
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path

import numpy as np

N_BOOT = 2000
# 키: PEDAL·HIHAT_SEP·HIHAT_ALL은 [tp, fp, fn], P2H·H2P는 [개수, 0, 0]
KEYS = ("PEDAL", "HIHAT_SEP", "HIHAT_ALL", "P2H", "H2P")
JUDGE_DATASETS = ("mdb_drums", "gmd_test")
MIN_F1, MIN_PREC, MAX_DROP = 0.5, 0.6, 0.02

# {(이름, 데이터셋): {곡: {키: [a, b, c]}}}
Counts = dict[tuple[str, str], dict[str, dict[str, list[int]]]]


def read_run(name: str, folder: Path, model: str | None, counts: Counts) -> None:
    """run-transcription 결과 폴더. 오류 곡은 results.csv의 error로 뺌. 모델이 여럿이면 model로 고름."""
    failed, models = set(), set()
    with (folder / "results.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if model and r["model"] != model:
                continue
            models.add(r["model"])
            if r.get("error"):
                failed.add((r["dataset"], r["songId"]))
    if len(models) != 1:
        raise ValueError(f"{folder}: 모델이 {sorted(models)}. 이름=폴더@모델로 하나를 고를 것")
    key_of = {
        ("pads9", "HIHAT_PEDAL"): "PEDAL",
        ("pads9", "HIHAT"): "HIHAT_SEP",
        ("pads", "HIHAT"): "HIHAT_ALL",
        ("pads9", "PEDAL_AS_HIHAT"): "P2H",
        ("pads9", "HIHAT_AS_PEDAL"): "H2P",
    }
    found = False
    with (folder / "hits_by_class.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["model"] not in models or r["windowMs"] != "50":
                continue
            if (r["dataset"], r["songId"]) in failed:
                continue
            key = key_of.get((r["scheme"], r["label"]))
            if key is None:
                continue
            found = True
            song = counts[(name, r["dataset"])].setdefault(r["songId"], {})
            song[key] = [int(r["tp"]), int(r["fp"]), int(r["fn"])]
    if not found:
        raise ValueError(f"{folder}: pads9 기준 행이 없음 (페달 채점이 들어간 뒤의 결과인지 확인)")


def read_rule_eval(name: str, folder: Path, candidate: str, counts: Counts) -> None:
    """rule-eval 결과 폴더의 by_song.csv에서 후보 candidate의 곡별 개수."""
    found = False
    with (folder / "by_song.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["candidate"] != candidate:
                continue
            if "tpHIHAT_PEDAL9" not in r:
                raise ValueError(
                    f"{folder}: 페달 열이 없음 (페달 채점이 들어간 뒤의 rule-eval인지 확인)"
                )
            found = True
            song = counts[(name, r["dataset"])].setdefault(r["songId"], {})
            song["PEDAL"] = [int(r[f"{k}HIHAT_PEDAL9"]) for k in ("tp", "fp", "fn")]
            song["HIHAT_SEP"] = [int(r[f"{k}HIHAT9"]) for k in ("tp", "fp", "fn")]
            song["HIHAT_ALL"] = [int(r[f"{k}HIHAT"]) for k in ("tp", "fp", "fn")]
            song["P2H"] = [int(r["pedalAsHihat"]), 0, 0]
            song["H2P"] = [int(r["hihatAsPedal"]), 0, 0]
    if not found:
        raise ValueError(f"{folder / 'by_song.csv'}에 후보 {candidate}가 없음")


def song_matrix(songs: dict[str, dict[str, list[int]]], key: str, order: list[str]) -> np.ndarray:
    return np.array([songs[s].get(key, [0, 0, 0]) for s in order], dtype=float).reshape(-1, 3)


def f1(tp: float, fp: float, fn: float) -> float:
    d = 2 * tp + fp + fn
    return 2 * tp / d if d else float("nan")


def boot_f1(m: np.ndarray, idx: np.ndarray) -> np.ndarray:
    s = m[idx].sum(axis=1)
    d = 2 * s[:, 0] + s[:, 1] + s[:, 2]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(d > 0, 2 * s[:, 0] / d, np.nan)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--run", action="append", default=[], help="이름=run-transcription 폴더[@모델]")
    p.add_argument("--rule-eval", action="append", default=[], help="이름=rule-eval 폴더@후보")
    p.add_argument("--baseline", default=None, help="하이햇+페달 F1 비교 기준 방식 이름")
    p.add_argument("--out", type=Path, default=None, help="표를 쓸 md 파일 (없으면 화면만)")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    counts: Counts = defaultdict(dict)
    names: list[str] = []
    for spec in args.run:
        name, folder = spec.split("=", 1)
        folder, _, model = folder.partition("@")
        read_run(name, Path(folder), model or None, counts)
        names.append(name)
    for spec in args.rule_eval:
        name, folder = spec.split("=", 1)
        folder, _, cand = folder.partition("@")
        if not cand:
            raise ValueError(f"--rule-eval {spec}: 이름=폴더@후보 형식이어야 함")
        read_rule_eval(name, Path(folder), cand, counts)
        names.append(name)
    names = list(dict.fromkeys(names))
    datasets = sorted({ds for _, ds in counts})
    rng = np.random.default_rng(args.seed)
    lines = ["# 페달 하이햇 비교", ""]
    # 판정용: {(이름, 데이터셋): (페달 F1, 페달 정밀도, 하이햇+페달 F1)}
    summary: dict[tuple[str, str], tuple[float, float, float]] = {}

    for ds in datasets:
        present = [n for n in names if (n, ds) in counts]
        common = sorted(set.intersection(*(set(counts[(n, ds)]) for n in present)))
        idx = rng.integers(0, len(common), size=(N_BOOT, len(common)))
        n_pedal = int(song_matrix(counts[(present[0], ds)], "PEDAL", common)[:, [0, 2]].sum())
        lines += [f"## {ds} (곡 {len(common)}개, 정답 페달 {n_pedal}타, 50ms)", ""]
        head = [
            "방식",
            "페달 F1 (95% 구간)",
            "페달 정밀도",
            "페달 재현율",
            "페달을 HIHAT으로",
            "HIHAT을 페달로",
            "하이햇(페달 제외) F1",
            "하이햇+페달 F1 (95% 구간)",
        ]
        lines += ["| " + " | ".join(head) + " |", "|" + " --- |" * len(head)]
        for n in present:
            songs = counts[(n, ds)]
            ped = song_matrix(songs, "PEDAL", common)
            tp, fp, fn = ped.sum(axis=0)
            lo, hi = np.nanpercentile(boot_f1(ped, idx), [2.5, 97.5])
            allm = song_matrix(songs, "HIHAT_ALL", common)
            alo, ahi = np.nanpercentile(boot_f1(allm, idx), [2.5, 97.5])
            prec = tp / (tp + fp) if tp + fp else float("nan")
            rec = tp / (tp + fn) if tp + fn else float("nan")
            p2h = int(song_matrix(songs, "P2H", common)[:, 0].sum())
            h2p = int(song_matrix(songs, "H2P", common)[:, 0].sum())
            sep = f1(*song_matrix(songs, "HIHAT_SEP", common).sum(axis=0))
            all_f1 = f1(*allm.sum(axis=0))
            summary[(n, ds)] = (f1(tp, fp, fn), prec, all_f1)
            lines.append(
                f"| {n} | {f1(tp, fp, fn):.3f} ({lo:.2f}~{hi:.2f}) | {prec:.3f} | {rec:.3f} | "
                f"{p2h} | {h2p} | {sep:.3f} | {all_f1:.3f} ({alo:.2f}~{ahi:.2f}) |"
            )
        lines += ["", "괄호는 곡 단위로 다시 뽑아 2,000번 계산한 95% 구간.", ""]

    lines += ["## 채택 판정 (설계 U22)", ""]
    for n in names:
        if n == args.baseline:
            continue
        reasons = []
        for ds in JUDGE_DATASETS:
            if (n, ds) not in summary:
                reasons.append(f"{ds} 결과 없음")
                continue
            pf1, prec, _ = summary[(n, ds)]
            if not pf1 >= MIN_F1:
                reasons.append(f"{ds} 페달 F1 {pf1:.3f} < {MIN_F1}")
            if not prec >= MIN_PREC:
                reasons.append(f"{ds} 페달 정밀도 {prec:.3f} < {MIN_PREC}")
        if args.baseline:
            for ds in datasets:
                if (n, ds) in summary and (args.baseline, ds) in summary:
                    drop = summary[(args.baseline, ds)][2] - summary[(n, ds)][2]
                    if drop > MAX_DROP:
                        reasons.append(f"{ds} 하이햇+페달 F1 {drop:.3f} 떨어짐")
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
