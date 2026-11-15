"""drum2midi 원본과 우리 탐 규칙 비교표.

drum2midi는 run-transcription 결과 폴더의 hits_by_class.csv(8패드·5가지, 50ms)에서,
우리 규칙은 rule-eval 결과 폴더의 by_song.csv(8패드 tp·fp·fn)와 tom* 열에서 곡별 개수를 읽어 같은 기준으로 셈.
점수는 묶음 안 모든 곡의 개수를 더해 계산한 F1(벤치마크와 같음). 탐 검출은 어느 탐인지 무시한 F1.
곡 단위로 다시 뽑아 2,000번 다시 계산한 95% 구간과, 같은 곡끼리 짝지은 탐 3종 F1 차이 구간을 같이 냄.
정답은 둘 다 데이터셋 원래 표기(탐 둘인 곡 위쪽 탐 이름 통일 없음)여야 함.

  uv run python scripts/compare_drum2midi.py \
      --run d2m=data/results/d2m-drums-mdb --run d2m=data/results/d2m-drums-gmd \
      --rule-eval fixed=data/results/rule-eval-tom-detect --rule-eval pk_gap30=data/results/rule-eval-tom-final \
      --out data/results/compare-drum2midi.md
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path

import numpy as np

TOMS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
CYMBALS = ("CRASH", "RIDE")
OTHERS = ("KICK", "SNARE", "HIHAT")
PADS = OTHERS + TOMS + CYMBALS
GROUPS = {"8패드": PADS, "탐 3종": TOMS, "크래시·라이드": CYMBALS, "킥·스네어·하이햇": OTHERS}
N_BOOT = 2000

# 곡별 개수: {(이름, 데이터셋): {곡: {키: [tp, fp, fn]}}}. 키는 패드 이름과 탐 검출용 "TOM_ANY"
Counts = dict[tuple[str, str], dict[str, dict[str, list[int]]]]


def read_run(name: str, folder: Path, model: str | None, counts: Counts) -> None:
    """run-transcription 결과 폴더의 hits_by_class.csv(50ms)를 읽음. 오류 곡은 results.csv의 error로 뺌.

    폴더에 모델이 여럿이면 model로 하나를 골라야 함.
    """
    failed = set()
    models = set()
    with (folder / "results.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if model and r["model"] != model:
                continue
            models.add(r["model"])
            if r.get("error"):
                failed.add((r["dataset"], r["songId"]))
    if len(models) != 1:
        raise ValueError(
            f"{folder}: 모델이 {sorted(models)}. --run 이름=폴더@모델로 하나를 고를 것"
        )
    with (folder / "hits_by_class.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["model"] not in models or r["windowMs"] != "50":
                continue
            if (r["dataset"], r["songId"]) in failed:
                continue
            if r["scheme"] == "pads":
                # 2026-10-26 패드 이름 변경 전 결과는 SMALL_TOM이 HI_TOM
                key = "SMALL_TOM" if r["label"] == "HI_TOM" else r["label"]
            elif r["scheme"] == "five" and r["label"] == "tom":
                key = "TOM_ANY"
            else:
                continue
            song = counts[(name, r["dataset"])].setdefault(r["songId"], {})
            song[key] = [int(r["tp"]), int(r["fp"]), int(r["fn"])]


def read_rule_eval(name: str, folder: Path, counts: Counts) -> None:
    """rule-eval 결과 폴더의 by_song.csv에서 후보 name의 곡별 개수를 읽음."""
    found = False
    with (folder / "by_song.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["candidate"] != name:
                continue
            found = True
            song = counts[(name, r["dataset"])].setdefault(r["songId"], {})
            for p in PADS:
                song[p] = [int(r[f"tp{p}"]), int(r[f"fp{p}"]), int(r[f"fn{p}"])]
            # 탐 검출: 시각이 맞은 탐 수, 남은 가짜 탐 수, 정답 탐 중 못 맞춘 수
            matched = int(r["tomMatched"])
            true_toms = sum(int(r[f"tp{p}"]) + int(r[f"fn{p}"]) for p in TOMS)
            song["TOM_ANY"] = [matched, int(r["tomFalseKept"]), true_toms - matched]
    if not found:
        raise ValueError(f"{folder / 'by_song.csv'}에 후보 {name}이 없음")


def f1(tp: float, fp: float, fn: float) -> float:
    d = 2 * tp + fp + fn
    return 2 * tp / d if d else float("nan")


def song_matrix(songs: dict[str, dict[str, list[int]]], keys, order: list[str]) -> np.ndarray:
    """곡 순서대로 (곡, 3) 개수 행렬. keys의 개수를 더함."""
    return np.array(
        [[sum(songs[s].get(k, [0, 0, 0])[i] for k in keys) for i in range(3)] for s in order],
        dtype=float,
    )


def boot_f1(m: np.ndarray, idx: np.ndarray) -> np.ndarray:
    s = m[idx].sum(axis=1)  # (반복, 3)
    d = 2 * s[:, 0] + s[:, 1] + s[:, 2]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(d > 0, 2 * s[:, 0] / d, np.nan)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument(
        "--run",
        action="append",
        default=[],
        help="이름=run-transcription 결과 폴더. 폴더에 모델이 여럿이면 이름=폴더@모델",
    )
    p.add_argument("--rule-eval", action="append", default=[], help="후보 이름=rule-eval 결과 폴더")
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
        read_rule_eval(name, Path(folder), counts)
        names.append(name)
    names = list(dict.fromkeys(names))
    datasets = sorted({ds for _, ds in counts})
    rng = np.random.default_rng(args.seed)
    lines = ["# drum2midi 원본 vs 우리 탐 규칙", ""]

    for ds in datasets:
        present = [n for n in names if (n, ds) in counts]
        # 모든 방식이 다 가진 곡만 비교(실패 곡 제외)
        common = sorted(set.intersection(*(set(counts[(n, ds)]) for n in present)))
        idx = rng.integers(0, len(common), size=(N_BOOT, len(common)))
        lines += [f"## {ds} (곡 {len(common)}개, 50ms)", ""]
        head = ["방식", *GROUPS, "탐 검출(어느 탐인지 무시)"]
        lines += ["| " + " | ".join(head) + " |", "|" + " --- |" * len(head)]
        tom_boot = {}
        for n in present:
            songs = counts[(n, ds)]
            cells = []
            for g, keys in [*GROUPS.items(), ("탐 검출", ("TOM_ANY",))]:
                m = song_matrix(songs, keys, common)
                b = boot_f1(m, idx)
                lo, hi = np.nanpercentile(b, [2.5, 97.5])
                cells.append(f"{f1(*m.sum(axis=0)):.3f} ({lo:.2f}~{hi:.2f})")
                if g == "탐 3종":
                    tom_boot[n] = b
            lines.append(f"| {n} | " + " | ".join(cells) + " |")
        lines += ["", "괄호는 곡 단위로 다시 뽑아 2,000번 계산한 95% 구간.", ""]
        if len(present) > 1:
            lines += ["탐 3종 F1 차이 (행 − 열, 같은 곡끼리 짝지어 다시 뽑은 95% 구간)", ""]
            lines += ["| | " + " | ".join(present) + " |", "|" + " --- |" * (len(present) + 1)]
            for a in present:
                row = []
                for b in present:
                    if a == b:
                        row.append("—")
                        continue
                    diff = tom_boot[a] - tom_boot[b]
                    lo, hi = np.nanpercentile(diff, [2.5, 97.5])
                    mark = " (0 포함)" if lo <= 0 <= hi else ""
                    row.append(f"{np.nanmedian(diff):+.3f} ({lo:+.2f}~{hi:+.2f}){mark}")
                lines.append(f"| {a} | " + " | ".join(row) + " |")
            lines += ["", "구간이 0을 포함하면 이 데이터로는 어느 쪽이 나은지 판정할 수 없음.", ""]

    text = "\n".join(lines)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n", encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
