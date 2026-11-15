"""NCS 기본곡 채보 곡별 점검. 등록 전에 50곡을 하나씩 측정해 표로 남김.

곡마다 측정하는 것
- 박자 칸: 노트가 16분음표 칸(채보 bpm·첫 박 기준)에서 15ms 넘게 벗어난 비율. 곡 앞 1/3·뒤 1/3 따로
  (뒤로 갈수록 커지면 bpm이 조금 틀려 점점 밀린 것)
- 정수 bpm: bpm을 가장 가까운 정수로 바꾸고 첫 박 위치를 반 박 안에서 다시 맞췄을 때의 벗어난 비율
- 셋잇단 칸: 한 박을 3·6으로 나눈 칸에서 벗어난 비율. 16분보다 훨씬 잘 맞으면 셋잇단·셔플 리듬
- 원곡 시각 차이: 원곡 온셋 세기와 킥·스네어 노트를 ±150ms에서 맞춰 본 가장 잘 맞는 차이(ms)와 그때 세기 비율
  (노트 자리 온셋 세기 평균 ÷ 곡 전체 평균. 1에 가까우면 노트가 소리와 상관없는 자리)
- 빈 구간: 첫 노트 뒤 노트가 없는 가장 긴 구간(초)과 8초 넘는 구간 수
- 패드 비율, 분당 노트, 첫·마지막 노트 시각, 같은 패드가 30ms 안에 두 번 나온 수
- 첫 박보다 앞선 노트 수(BE 등록 거부 대상)

AI/ 에서
  uv run python scripts/ncs_inspect.py --charts data/ncs/charts --audio data/ncs/audio --out data/ncs/inspect.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ncs_prepare import DEFAULT_SONGS, read_songs  # noqa: E402

GRID_TOL_MS = 15.0
GAP_SEC = 8.0
DOUBLE_MS = 30
LAG_MAX_MS = 150
HOP = 128
SR = 22050


def off_grid_ratio(times_ms: np.ndarray, bpm: float, offset_ms: float, div: int = 4) -> float:
    """한 박을 div칸으로 나눈 격자에서 GRID_TOL_MS 넘게 벗어난 노트 비율."""
    if len(times_ms) == 0:
        return 0.0
    beat = 60000.0 / bpm
    pos = (times_ms - offset_ms) / beat * div
    dist = np.abs(pos - np.round(pos)) / div * beat
    return float(np.mean(dist > GRID_TOL_MS))


def best_phase(
    times_ms: np.ndarray, bpm: float, offset_ms: float, div: int = 4
) -> tuple[float, float]:
    """첫 박을 원래 값 ±반 박 안에서 1ms 간격으로 옮겨 벗어난 비율이 가장 작은 위치와 그 비율."""
    beat = 60000.0 / bpm
    cands = offset_ms + np.arange(-beat / 2, beat / 2, 1.0)
    vals = np.array([off_grid_ratio(times_ms, bpm, o, div) for o in cands])
    i = int(np.argmin(vals))
    return float(cands[i]), float(vals[i])


def thirds(times_ms: np.ndarray, bpm: float, offset_ms: float) -> tuple[float, float]:
    n = len(times_ms) // 3
    if n == 0:
        return 0.0, 0.0
    return off_grid_ratio(times_ms[:n], bpm, offset_ms), off_grid_ratio(
        times_ms[-n:], bpm, offset_ms
    )


def onset_lag(audio_path: Path, times_ms: np.ndarray) -> tuple[float, float]:
    """원곡 온셋 세기와 노트 시각을 맞춰 본 가장 잘 맞는 차이(ms, +면 노트가 소리보다 늦음)와 세기 비율."""
    import librosa

    y, sr = librosa.load(str(audio_path), sr=SR, mono=True)
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    env = env / (env.mean() + 1e-9)
    frame_ms = HOP * 1000.0 / sr
    best = (0.0, -1.0)
    for lag in np.arange(-LAG_MAX_MS, LAG_MAX_MS + 1, 2):
        idx = np.round((times_ms - lag) / frame_ms).astype(int)
        idx = idx[(idx >= 0) & (idx < len(env))]
        if len(idx) == 0:
            continue
        score = float(env[idx].mean())
        if score > best[1]:
            best = (float(lag), score)
    return best


def gaps(times_ms: np.ndarray) -> tuple[float, int]:
    if len(times_ms) < 2:
        return 0.0, 0
    d = np.diff(np.unique(times_ms)) / 1000.0
    return float(d.max()), int(np.sum(d > GAP_SEC))


def doubles(notes: list[dict]) -> int:
    """같은 패드가 DOUBLE_MS 안에 두 번 나온 수."""
    last: dict[str, int] = {}
    n = 0
    for x in notes:
        t, p = x["timeMs"], x["pad"]
        if p in last and t - last[p] < DOUBLE_MS:
            n += 1
        last[p] = t
    return n


def inspect_song(stem: str, chart_doc: dict, audio: Path | None) -> dict:
    ch = chart_doc["charts"][0]
    notes = ch["notes"]
    t = np.array([n["timeMs"] for n in notes], dtype=float)
    bpm, off = float(ch["timing"]["bpm"]), float(ch["timing"]["offsetMs"])
    dur = int(chart_doc["metrics"]["durationMs"])
    front, back = thirds(t, bpm, off)
    ibpm = float(round(bpm))
    ioff, igrid = best_phase(t, ibpm, off)
    ifront, iback = thirds(t, ibpm, ioff)
    _, trip = best_phase(t, ibpm, off, div=3)
    _, trip6 = best_phase(t, ibpm, off, div=6)
    pads: dict[str, int] = {}
    for n in notes:
        pads[n["pad"]] = pads.get(n["pad"], 0) + 1
    ks = np.array([n["timeMs"] for n in notes if n["pad"] in ("KICK", "SNARE")], dtype=float)
    lag, strength = (
        onset_lag(audio, ks if len(ks) else t) if audio else (float("nan"), float("nan"))
    )
    gmax, gcount = gaps(t)
    beat = 60000.0 / bpm
    row = {
        "곡": stem,
        "bpm": bpm,
        "첫 박 ms": int(off),
        "노트": len(notes),
        "분당 노트": round(len(notes) / dur * 60000) if dur else 0,
        "16분 칸 벗어남 %": round(off_grid_ratio(t, bpm, off) * 100),
        "앞 1/3 %": round(front * 100),
        "뒤 1/3 %": round(back * 100),
        "정수 bpm": ibpm,
        "정수 bpm 첫 박 ms": round(ioff),
        "정수 bpm 벗어남 %": round(igrid * 100),
        "정수 bpm 앞 1/3 %": round(ifront * 100),
        "정수 bpm 뒤 1/3 %": round(iback * 100),
        "셋잇단(3칸) 벗어남 %": round(trip * 100),
        "셋잇단(6칸) 벗어남 %": round(trip6 * 100),
        "원곡 시각 차이 ms": lag,
        "원곡 온셋 세기 비율": round(strength, 2),
        "첫 노트 초": round(t[0] / 1000, 1) if len(t) else "",
        "마지막 노트 초": round(t[-1] / 1000, 1) if len(t) else "",
        "곡 길이 초": round(dur / 1000, 1),
        "가장 긴 빈 구간 초": round(gmax, 1),
        "8초 넘는 빈 구간 수": gcount,
        "같은 패드 30ms 안 두 번": doubles(notes),
        "첫 박 앞 노트": int(np.sum(t < off - beat / 8)),
    }
    for p in ("KICK", "SNARE", "HIHAT", "CRASH", "RIDE", "SMALL_TOM", "MID_TOM", "FLOOR_TOM"):
        row[f"{p} %"] = round(pads.get(p, 0) / max(len(notes), 1) * 100)
    return row


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--songs", type=Path, default=DEFAULT_SONGS)
    ap.add_argument("--charts", type=Path, default=Path("data/ncs/charts"))
    ap.add_argument("--audio", type=Path, default=Path("data/ncs/audio"), help="원곡 opus 폴더")
    ap.add_argument("--out", type=Path, default=Path("data/ncs/inspect.csv"))
    args = ap.parse_args(argv)
    rows = []
    for s in read_songs(args.songs):
        doc = json.loads((args.charts / s.stem / "chart.json").read_text(encoding="utf-8"))
        audio = args.audio / f"{s.stem}.opus"
        rows.append(inspect_song(s.stem, doc, audio if audio.is_file() else None))
        r = rows[-1]
        print(
            f"{s.stem[:45]}: 칸 벗어남 {r['16분 칸 벗어남 %']}% → 정수 bpm {r['정수 bpm 벗어남 %']}%, "
            f"원곡 차이 {r['원곡 시각 차이 ms']}ms",
            flush=True,
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)}곡 → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
