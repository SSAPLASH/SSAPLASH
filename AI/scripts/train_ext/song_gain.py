"""킥이 탐으로 잡히는 곡에서 킥 점수를 키우는 규칙 (11/11, STRUM CRNN용).

측정(실제 곡으로 학습한 STRUM CRNN, ENST 드러머 1): 킥 정답 시각의 점수 중앙값이 킥 0.34, 플로어 탐 0.67,
미드 탐 0.61로 킥이 탐으로 잡힘. 검증 곡에서 고른 킥 문턱값을 넘는 킥이 곡마다 0개이고 탐은 30 ~ 178개.
다른 드러머와 MDB는 킥이 탐보다 많음(MDB 재즈 곡은 킥 25 ~ 31개, 탐 0개).

규칙
1. 문턱값을 넘는 탐 수가 킥 수보다 많은 곡만 대상
2. 그 곡의 킥 봉우리 점수 위쪽 값(--q 백분위)이 기준값(검증 10곡 중앙값)보다 낮으면 그 비율만큼 킥 점수를 키움(최대 --max-gain배)
3. 키운 뒤 문턱값을 넘는 킥과 같은 시각(±--near초)의 탐 봉우리는 지움(같은 타격이 킥과 탐으로 같이 잡힌 것)

문턱값은 규칙 없이 고른 값(--params, ext_rule_eval fit 결과)을 씀. ENST 드러머 1과 MDB를 보고 만든 규칙이라
두 묶음 점수는 이 규칙의 공정한 시험이 아님. 시험 31곡·처음 보는 38곡에서 안 떨어지는지로 판단.

  uv run python scripts/train_ext/song_gain.py --src strum_p3_real --dst strum_p3_real_sg --kind p3 --params data/results/ext_notes/rules_strum_p3_real.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

TOMS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")


def ref_of(score: np.ndarray, q: float, floor: int, min_peaks: int) -> float | None:
    s = score[score >= floor]
    return float(np.percentile(s, q)) if len(s) >= min_peaks else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", required=True, help="노트 폴더 이름")
    ap.add_argument("--dst", required=True)
    ap.add_argument("--kind", required=True, help="라벨 앞머리(p3). 라벨은 <kind>/<패드>")
    ap.add_argument("--params", required=True, help="규칙 없이 고른 문턱값 json")
    ap.add_argument("--notes", type=Path, default=Path("data/results/ext_notes"))
    ap.add_argument("--val", default="public_songs_val", help="기준값을 구할 데이터셋 폴더")
    ap.add_argument("--q", type=float, default=90.0)
    ap.add_argument("--floor", type=int, default=200, help="이 점수(×1000) 이상 봉우리만 셈")
    ap.add_argument("--min-peaks", type=int, default=20)
    ap.add_argument("--max-gain", type=float, default=2.5)
    ap.add_argument("--near", type=float, default=0.03)
    ap.add_argument("--no-guard", action="store_true", help="1번 조건 없이 모든 곡에 적용(비교용)")
    args = ap.parse_args()

    thr = json.loads(Path(args.params).read_text(encoding="utf-8"))["thr"]
    kick = f"{args.kind}/KICK"
    toms = [f"{args.kind}/{t}" for t in TOMS]
    refs = []
    for f in sorted((args.notes / args.src / args.val).glob("*.npz")):
        z = np.load(f)
        r = ref_of(z["velocity"][z["label"] == kick], args.q, args.floor, args.min_peaks)
        if r is not None:
            refs.append(r)
    target = float(np.median(refs))
    print(f"[song_gain] 킥 기준값 {target:.0f} (검증 곡 {len(refs)}개)")
    for folder in sorted(p for p in (args.notes / args.src).iterdir() if p.is_dir()):
        applied, dropped = 0, 0
        files = sorted(folder.glob("*.npz"))
        for f in files:
            z = dict(np.load(f))
            label, onset = z["label"], z["onset"]
            score = z["velocity"].astype(np.float64)
            is_kick = label == kick
            n_kick = int((score[is_kick] >= thr.get(kick, 0)).sum())
            n_tom = sum(int((score[label == t] >= thr.get(t, 0)).sum()) for t in toms)
            r = ref_of(score[is_kick], args.q, args.floor, args.min_peaks)
            if r is not None and (args.no_guard or n_tom > n_kick):
                g = float(np.clip(target / r, 1.0, args.max_gain))
                if g > 1.0:
                    score[is_kick] = np.minimum(score[is_kick] * g, 1000)
                    applied += 1
                    strong = np.sort(onset[is_kick & (score >= thr.get(kick, 0))])
                    if len(strong) and not args.no_guard:
                        for t in toms:
                            idx = np.flatnonzero(label == t)
                            pos = np.searchsorted(strong, onset[idx]).clip(1, len(strong) - 1)
                            gap = np.minimum(
                                np.abs(strong[pos] - onset[idx]),
                                np.abs(strong[pos - 1] - onset[idx]),
                            )
                            hit = idx[gap <= args.near]
                            dropped += int((score[hit] >= thr.get(t, 0)).sum())
                            score[hit] = 0
            z["velocity"] = np.rint(score).astype(np.int32)
            out = args.notes / args.dst / folder.name / f.name
            out.parent.mkdir(parents=True, exist_ok=True)
            np.savez(out, **z)
        print(f"[song_gain] {folder.name} 곡 {len(files)} 적용 {applied}곡, 지운 탐 {dropped}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
