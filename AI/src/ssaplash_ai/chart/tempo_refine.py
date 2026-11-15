"""채보 노트로 bpm·첫 박(offsetMs) 다시 맞추기. 노트 시각은 바꾸지 않음.

박 시각이 20ms 단위라 bpm이 0.01~0.07 틀리게 잡히면 곡 끝으로 갈수록 메트로놈과 마디선이 노트와 어긋남.
1. 지금 bpm에서 노트가 16분·셋잇단 칸을 GRID_TOL_MS 넘게 벗어난 비율과 곡 처음→끝 밀림을 구함
2. 정수 bpm(±1) 후보마다 첫 박을 ±반 칸 안에서 옮겨 벗어난 비율이 가장 작은 위치를 찾음
3. 비율이 MIN_GRID_GAIN 넘게 줄거나, MAX_GRID_LOSS 넘게 늘지 않으면서 밀림이 MIN_DRIFT_GAIN_MS 이상 줄면 채택
4. 안 맞으면 지금 bpm ±FINE_STEPS×0.01을 같은 방법으로 봄
5. 노트가 MIN_NOTES 미만, 첫 박이 0 미만, bpm이 범위 밖이면 바꾸지 않음
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

GRID_TOL_MS = 15.0
GRID_DIVS = (4, 6)
DRIFT_WINDOW_MS = 40.0
DRIFT_MIN_NOTES = 20
MIN_GRID_GAIN = 0.05
MAX_GRID_LOSS = 0.01
MIN_DRIFT_GAIN_MS = 5.0
FINE_STEPS = 10
FINE_STEP_BPM = 0.01
MIN_NOTES = 64


@dataclass(frozen=True)
class RefineResult:
    """보정 결과. changed가 거짓이면 bpm·offset_ms는 입력 그대로."""

    bpm: float
    offset_ms: int
    changed: bool
    reason: str
    grid_div: int
    before_off_grid: float
    after_off_grid: float
    before_drift_ms: float
    after_drift_ms: float

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("before_off_grid", "after_off_grid"):
            d[k] = round(d[k], 4)
        for k in ("before_drift_ms", "after_drift_ms"):
            d[k] = round(d[k], 1)
        return d


def _grid_dist(times_ms: np.ndarray, bpm: float, offset_ms: float, div: int) -> np.ndarray:
    beat = 60000.0 / bpm
    pos = (times_ms - offset_ms) / beat * div
    return np.abs(pos - np.round(pos)) / div * beat


def off_grid_ratio(times_ms: np.ndarray, bpm: float, offset_ms: float, div: int = 4) -> float:
    """한 박을 div칸으로 나눈 격자에서 GRID_TOL_MS 넘게 벗어난 노트 비율."""
    if len(times_ms) == 0:
        return 0.0
    return float(np.mean(_grid_dist(times_ms, bpm, offset_ms, div) > GRID_TOL_MS))


def best_off_grid(times_ms: np.ndarray, bpm: float, offset_ms: float) -> float:
    """16분·셋잇단 칸 중 더 잘 맞는 쪽의 벗어난 비율."""
    return min(off_grid_ratio(times_ms, bpm, offset_ms, d) for d in GRID_DIVS)


def metronome_drift(times_ms: np.ndarray, bpm: float, offset_ms: float) -> float:
    """곡 처음→끝에 메트로놈(16분 칸)이 노트와 얼마나 더 어긋나는지(ms). +면 끝으로 갈수록 노트가 늦어짐.

    칸에서 DRIFT_WINDOW_MS 안쪽 노트의 부호 있는 거리를 시간에 대해 직선으로 맞춘 기울기 × (마지막 - 첫 노트).
    """
    beat = 60000.0 / bpm
    pos = (times_ms - offset_ms) / beat * 4
    res = (pos - np.round(pos)) / 4 * beat
    m = np.abs(res) <= DRIFT_WINDOW_MS
    if m.sum() < DRIFT_MIN_NOTES:
        return 0.0
    slope = np.polyfit(times_ms[m], res[m], 1)[0]
    return float(slope * (times_ms[m][-1] - times_ms[m][0]))


def fit_phase(times_ms: np.ndarray, bpm: float, offset_ms: float) -> tuple[float, float, int]:
    """첫 박을 offset_ms ±반 칸 안에서 맞춤 → (벗어난 비율, 첫 박 ms, 칸 수)."""
    best = (2.0, float("inf"), offset_ms, GRID_DIVS[0])
    for div in GRID_DIVS:
        half = 60000.0 / bpm / div / 2
        for o in offset_ms + np.arange(-half, half, 1.0):
            d = _grid_dist(times_ms, bpm, o, div)
            on = d <= GRID_TOL_MS
            key = (float(np.mean(~on)), float(d[on].mean()) if on.any() else float("inf"))
            if key < best[:2]:
                best = (key[0], key[1], float(o), div)
    return best[0], best[2], best[3]


def refine_timing(
    times_ms: np.ndarray | list[float],
    bpm: float,
    offset_ms: int,
    min_bpm: float = 60.0,
    max_bpm: float = 200.0,
) -> RefineResult:
    """노트 시각으로 bpm·offsetMs 다시 맞추기. 모듈 docstring 계산."""
    t = np.sort(np.asarray(times_ms, dtype=float))
    bpm = float(bpm)
    if len(t) < MIN_NOTES or bpm <= 0:
        return RefineResult(bpm, int(offset_ms), False, "노트 부족", 4, 0.0, 0.0, 0.0, 0.0)
    cur = best_off_grid(t, bpm, offset_ms)
    drift0 = metronome_drift(t, bpm, offset_ms)
    keep = RefineResult(bpm, int(offset_ms), False, "", 4, cur, cur, drift0, drift0)

    def judge(f: float, b: float, o: float) -> tuple[bool, float, str]:
        d = metronome_drift(t, b, o)
        if b == bpm or o < 0 or not (min_bpm <= b <= max_bpm):
            return False, d, ""
        if cur - f > MIN_GRID_GAIN:
            return True, d, "박자 칸 벗어남 줄어듦"
        if f <= cur + MAX_GRID_LOSS and abs(drift0) - abs(d) >= MIN_DRIFT_GAIN_MS:
            return True, d, "메트로놈 밀림 줄어듦"
        return False, d, ""

    whole = round(bpm)
    cands = []
    for b in (whole - 1, whole, whole + 1):
        f, o, div = fit_phase(t, float(b), float(offset_ms))
        cands.append((f, float(b), o, div))
    f, b, o, div = min(cands)
    ok, d, why = judge(f, b, o)
    if not ok:
        fine = []
        for k in range(-FINE_STEPS, FINE_STEPS + 1):
            bb = round(bpm + k * FINE_STEP_BPM, 2)
            ff, oo, dd = fit_phase(t, bb, float(offset_ms))
            good, dr, w = judge(ff, bb, oo)
            if good:
                fine.append((abs(dr), ff, bb, oo, dd, dr, w))
        if not fine:
            return keep
        _, f, b, o, div, d, why = min(fine)
    return RefineResult(float(b), int(round(o)), True, why, div, cur, f, drift0, d)
