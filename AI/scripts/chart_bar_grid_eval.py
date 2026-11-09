"""채보 JSON 마디선(timing)이 실제 곡 마디와 맞는지 측정 (설계 CHART-003-downbeat-vote·CHART-003-variable-tempo-exp).

정답: Songsterr 곡 폴더 `<곡>/final/bars.json`의 `bar_start`(탭 마디 시작을 음원에 맞춘 시각, 초).
마디선: Beat This! 박·마디 첫 박 캐시(`<곡>.npz`의 beats·downbeats)로 서비스와 같은 코드
(`estimate_from_beats` → `build_chart`)를 돌려 만든 채보 JSON timing. tempoMap이 있으면 BE·FE와 같은 식
(틱 0 = offsetMs, 구간마다 틱 차 × 60000 / ppq / bpm)으로 박 번호를 셈.
원점 보정에 쓰는 노트는 --pred-charts가 있으면 그 예측 채보, 없으면 정답 채보(`final/chart.json`) 노트.

비교할 방법은 --variant 이름=캐시폴더:tempo_map(0 또는 1)로 여러 개. 나머지 설정은 --config 그대로.
곡마다 정답 마디 시작(정답 노트가 있는 구간 안) 중 마디선 70ms 안에 든 비율과, 정답 노트 중 16분 칸 중심에서
칸 1/4 넘게 벗어난 비율(FE 악보 점 표시 기준)을 냄. 마디선 80% 이상인 곡 수와 첫 방법 대비 좋아짐·나빠짐을 셈.
출력: --out csv (곡 × 방법), 화면에 요약.

  uv run python scripts/chart_bar_grid_eval.py --songs data/songsterr \\
      --variant before=data/results/repeat/beats/public_songs:0 --variant after=<원곡 DBN 캐시>:1 \\
      --out data/results/chart-bar-grid/public_songs.csv
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import replace
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.pads import HITS_DTYPE
from ssaplash_ai.chart.chart_json import build_chart
from ssaplash_ai.chart.config import TranscriptionConfig
from ssaplash_ai.chart.tempo import estimate_from_beats

TOL_SEC = 0.07
GOOD = 0.8


def load_pred(paths: list[Path]) -> dict[str, list[tuple[float, str]]]:
    """예측 채보 npz(곡 이름 → (time_sec, pad, velocity) 표). 같은 곡이 여러 파일에 있으면 앞 파일"""
    pred: dict[str, list[tuple[float, str]]] = {}
    for p in paths:
        z = np.load(p, allow_pickle=True)
        for sid in z.files:
            pred.setdefault(sid, [(float(r[0]), str(r[1])) for r in z[sid]])
    return pred


def beat_fn(timing: dict):
    """채보 JSON timing → (곡 시각 초 → 박 번호) 함수. 틱 0 = offsetMs, 첫 구간 앞은 timing.bpm으로 거꾸로 셈"""
    offset = timing["offsetMs"] / 1000.0
    tempo_map = timing.get("tempoMap")
    if not tempo_map or len(tempo_map) < 2:
        bpm = timing["bpm"]
        return lambda t: (np.asarray(t, float) - offset) * bpm / 60.0
    ppq = timing["ppq"]
    beats = np.array([e["tick"] / ppq for e in tempo_map])
    bpms = np.array([e["bpm"] for e in tempo_map])
    starts = offset + np.r_[0.0, np.cumsum(np.diff(beats) * 60.0 / bpms[:-1])]

    def f(t):
        t = np.asarray(t, float)
        i = np.clip(np.searchsorted(starts, t, side="right") - 1, 0, len(starts) - 1)
        return beats[i] + (t - starts[i]) * bpms[i] / 60.0

    return f


def measure(timing: dict, bar_starts: np.ndarray, note_sec: np.ndarray, beats_per_bar: int):
    f = beat_fn(timing)
    pos = f(bar_starts)
    miss_beats = np.abs((pos + beats_per_bar / 2) % beats_per_bar - beats_per_bar / 2)
    sec_per_beat = 1e-3 / np.maximum(f(bar_starts + 1e-3) - pos, 1e-9)
    hit = float(np.mean(miss_beats * sec_per_beat <= TOL_SEC))
    step = f(note_sec) * 4
    off = float(np.mean(np.abs(step - np.round(step)) > 0.25))
    return hit, off


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--songs", type=Path, required=True, help="Songsterr 곡 폴더들의 부모")
    parser.add_argument(
        "--variant", action="append", required=True, help="이름=Beat This! 캐시 폴더:tempo_map(0/1)"
    )
    parser.add_argument("--pred-charts", type=Path, nargs="*", default=[], help="예측 채보 npz")
    parser.add_argument("--config", type=Path, default=Path("configs/chart/transcription.yaml"))
    parser.add_argument("--out", type=Path, required=True, help="곡별 결과 csv")
    args = parser.parse_args()

    cfg = TranscriptionConfig.from_yaml(args.config).tempo
    variants = []
    for v in args.variant:
        name, rest = v.split("=", 1)
        folder, flag = rest.rsplit(":", 1)
        variants.append((name, Path(folder), replace(cfg, tempo_map=flag == "1")))
    beats_per_bar = int(cfg.time_signature.split("/")[0])
    pred = load_pred(args.pred_charts)

    rows = []
    for cache in sorted(variants[0][1].glob("*.npz")):
        sid = cache.stem
        final = args.songs / sid / "final"
        if not (final / "bars.json").is_file():
            continue
        bars = json.loads((final / "bars.json").read_text(encoding="utf-8"))
        truth = json.loads((final / "chart.json").read_text(encoding="utf-8"))["charts"][0]["notes"]
        note_sec = np.array([n["timeMs"] / 1000 for n in truth])
        starts = np.asarray(bars["bar_start"], float)
        starts = starts[(starts >= note_sec.min() - 0.1) & (starts <= note_sec.max())]
        hits_src = pred.get(sid) or [(n["timeMs"] / 1000, n["pad"]) for n in truth]
        hits = np.array([(t, p, -1) for t, p in hits_src], dtype=HITS_DTYPE)
        duration_ms = int(note_sec.max() * 1000) + 5000
        row = {"song": sid, "pred_notes": sid in pred}
        for name, folder, tcfg in variants:
            z = np.load(folder / f"{sid}.npz")
            tempo = estimate_from_beats(z["beats"], z["downbeats"], tcfg, "beat_this")
            chart = build_chart(hits, duration_ms, tempo, "eval@0", 0, origin=tcfg.origin)
            timing = chart["charts"][0]["timing"]
            hit, off = measure(timing, starts, note_sec, beats_per_bar)
            row[f"{name}_hit"] = round(hit, 3)
            row[f"{name}_off"] = round(off, 3)
            row[f"{name}_segments"] = len(timing.get("tempoMap", [])) or 1
        rows.append(row)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    base = variants[0][0]
    b_hit = np.array([r[f"{base}_hit"] for r in rows])
    print(f"곡 {len(rows)} (예측 노트 {sum(r['pred_notes'] for r in rows)})")
    for name, _, _ in variants:
        hit = np.array([r[f"{name}_hit"] for r in rows])
        off = np.array([r[f"{name}_off"] for r in rows])
        seg = np.array([r[f"{name}_segments"] for r in rows])
        print(
            f"{name}: 마디선 {GOOD:.0%} 이상 {int((hit >= GOOD).sum())}곡,"
            f" 16분 칸 어긋남 평균 {off.mean():.1%}, 구간 수 중앙값 {int(np.median(seg))},"
            f" {base} 대비 좋아짐 {int(((b_hit < GOOD) & (hit >= GOOD)).sum())}"
            f" 나빠짐 {int(((b_hit >= GOOD) & (hit < GOOD)).sum())}"
        )
    print("저장", args.out)


if __name__ == "__main__":
    main()
