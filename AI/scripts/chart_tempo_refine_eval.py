"""채보 bpm 보정(chart/tempo_refine.py) 전후 측정.

1. Songsterr: 정답 마디(`<곡>/final/bars.json` bar_start, 탭 마디를 음원에 맞춘 시각)가 마디선 70ms 안에 든 비율.
   마디선은 서비스와 같은 계산: 분리 드럼 Beat This! 박 캐시(`<곡>.npz`) → `estimate_from_beats` → `grid_origin_ms`
   → `align_origin_to_notes`(보정 전) → `refine_timing`(보정 후). 노트는 --pred-charts 예측 채보, 없는 곡은 정답 채보.
   (-321 `chart_bar_grid_eval.py`와 같은 데이터·같은 비율 계산)
2. NCS: 서버 채보 JSON(`<ncs>/<곡>/chart.json`)의 bpm·offsetMs로 보정 전후 16분·셋잇단 칸 벗어난 비율과 곡 처음→끝 밀림

AI/ 에서
  uv run python scripts/chart_tempo_refine_eval.py --songs ../../S15P31A307/AI/data/songsterr \\
      --beats ../../S15P31A307/AI/data/results/repeat/beats/public_songs \\
      --pred-charts ../../S15P31A307/AI/data/results/judge/{val10,hold8,hold30}/private/chart.npz \\
      --ncs data/ncs/charts --out data/results/tempo-refine
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np

from ssaplash_ai.chart.chart_json import align_origin_to_notes, grid_origin_ms
from ssaplash_ai.chart.config import TranscriptionConfig
from ssaplash_ai.chart.tempo import estimate_from_beats
from ssaplash_ai.chart.tempo_refine import best_off_grid, metronome_drift, refine_timing

TOL_SEC = 0.07
GOOD = 0.8
WORSE_PP = 0.05
DRIFT_LIMIT_MS = 10.0


def load_pred(paths: list[Path]) -> dict[str, list[dict]]:
    """예측 채보 npz(곡 이름 → (time_sec, pad, velocity) 표). 같은 곡이 여러 파일에 있으면 앞 파일."""
    pred: dict[str, list[dict]] = {}
    for p in paths:
        z = np.load(p, allow_pickle=True)
        for sid in z.files:
            pred.setdefault(
                sid, [{"timeMs": int(round(float(r[0]) * 1000)), "pad": str(r[1])} for r in z[sid]]
            )
    return pred


def bar_hit(bar_starts: np.ndarray, offset_sec: float, bar_sec: float) -> float:
    d = np.abs((bar_starts - offset_sec + bar_sec / 2) % bar_sec - bar_sec / 2)
    return float(np.mean(d <= TOL_SEC))


def eval_songsterr(songs: Path, beats: Path, pred_paths: list[Path], config: Path) -> list[dict]:
    cfg = TranscriptionConfig.from_yaml(config).tempo
    pred = load_pred(pred_paths)
    rows = []
    for cache in sorted(beats.glob("*.npz")):
        sid = cache.stem
        final = songs / sid / "final"
        if not (final / "bars.json").is_file():
            continue
        bars = json.loads((final / "bars.json").read_text(encoding="utf-8"))
        truth = json.loads((final / "chart.json").read_text(encoding="utf-8"))["charts"][0]["notes"]
        notes = pred.get(sid, truth)
        t = np.array([n["timeMs"] / 1000 for n in truth])
        starts = np.asarray(bars["bar_start"], float)
        starts = starts[(starts >= t.min() - 0.1) & (starts <= t.max())]
        z = np.load(cache)
        tempo = estimate_from_beats(z["beats"], z["downbeats"], cfg, "beat_this")
        beats_per_bar = int(tempo.time_signature.split("/")[0])
        off0 = align_origin_to_notes(grid_origin_ms(tempo), tempo, notes)
        r = refine_timing([n["timeMs"] for n in notes], tempo.bpm, off0, cfg.min_bpm, cfg.max_bpm)
        truth_bpm = float(np.median(bars["bar_bpm"]))
        rows.append(
            {
                "song": sid,
                "pred_notes": sid in pred,
                "truth_bpm": round(truth_bpm, 2),
                "bpm_before": tempo.bpm,
                "bpm_after": r.bpm,
                "offset_before": off0,
                "offset_after": r.offset_ms,
                "changed": r.changed,
                "reason": r.reason,
                "hit_before": round(
                    bar_hit(starts, off0 / 1000, 60.0 / tempo.bpm * beats_per_bar), 3
                ),
                "hit_after": round(
                    bar_hit(starts, r.offset_ms / 1000, 60.0 / r.bpm * beats_per_bar), 3
                ),
            }
        )
    return rows


def eval_ncs(ncs: Path) -> list[dict]:
    rows = []
    for p in sorted(ncs.glob("*/chart.json")):
        ch = json.loads(p.read_text(encoding="utf-8"))["charts"][0]
        t = np.array([n["timeMs"] for n in ch["notes"]], float)
        bpm, off = float(ch["timing"]["bpm"]), int(ch["timing"]["offsetMs"])
        r = refine_timing(t, bpm, off)
        rows.append(
            {
                "song": p.parent.name,
                "bpm_before": bpm,
                "bpm_after": r.bpm,
                "changed": r.changed,
                "off_grid_before": round(best_off_grid(t, bpm, off), 3),
                "off_grid_after": round(best_off_grid(t, r.bpm, r.offset_ms), 3),
                "drift_before": round(metronome_drift(t, bpm, off), 1),
                "drift_after": round(metronome_drift(t, r.bpm, r.offset_ms), 1),
            }
        )
    return rows


def write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--songs", type=Path, help="Songsterr 곡 폴더들의 부모")
    ap.add_argument("--beats", type=Path, help="Beat This! 캐시 폴더 (<곡>.npz)")
    ap.add_argument("--pred-charts", type=Path, nargs="*", default=[])
    ap.add_argument("--ncs", type=Path, help="NCS 서버 채보 결과 폴더")
    ap.add_argument("--config", type=Path, default=Path("configs/chart/transcription.yaml"))
    ap.add_argument("--out", type=Path, default=Path("data/results/tempo-refine"))
    args = ap.parse_args(argv)
    if args.songs and args.beats:
        rows = eval_songsterr(args.songs, args.beats, args.pred_charts, args.config)
        write(args.out / "songsterr.csv", rows)
        hb = np.array([r["hit_before"] for r in rows])
        ha = np.array([r["hit_after"] for r in rows])
        eb = np.array([abs(r["bpm_before"] - r["truth_bpm"]) for r in rows])
        ea = np.array([abs(r["bpm_after"] - r["truth_bpm"]) for r in rows])
        print(
            f"Songsterr {len(rows)}곡 (예측 노트 {sum(r['pred_notes'] for r in rows)}), 보정한 곡 {sum(r['changed'] for r in rows)}"
        )
        print(f"  마디선 {GOOD:.0%} 이상 곡: {int((hb >= GOOD).sum())} → {int((ha >= GOOD).sum())}")
        print(
            f"  비율 {WORSE_PP:.0%}p 넘게 좋아짐 {int((ha - hb > WORSE_PP).sum())}, 나빠짐 {int((hb - ha > WORSE_PP).sum())}"
        )
        print(
            f"  정답 bpm과 차이 중앙값 {np.median(eb):.3f} → {np.median(ea):.3f}, 0.05 넘는 곡 {int((eb > 0.05).sum())} → {int((ea > 0.05).sum())}"
        )
        for r in rows:
            if r["hit_before"] - r["hit_after"] > WORSE_PP:
                print(
                    f"    나빠진 곡 {r['song']} {r['hit_before']} → {r['hit_after']} bpm {r['bpm_before']}→{r['bpm_after']} (정답 {r['truth_bpm']})"
                )
    if args.ncs:
        rows = eval_ncs(args.ncs)
        write(args.out / "ncs.csv", rows)
        db = np.array([abs(r["drift_before"]) for r in rows])
        da = np.array([abs(r["drift_after"]) for r in rows])
        worse = [r for r in rows if r["off_grid_after"] > r["off_grid_before"] + 0.01]
        print(f"NCS {len(rows)}곡, 보정한 곡 {sum(r['changed'] for r in rows)}")
        print(
            f"  밀림 {DRIFT_LIMIT_MS:g}ms 넘는 곡 {int((db > DRIFT_LIMIT_MS).sum())} → {int((da > DRIFT_LIMIT_MS).sum())}, 벗어난 비율 나빠진 곡 {len(worse)}"
        )
    print("저장", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
