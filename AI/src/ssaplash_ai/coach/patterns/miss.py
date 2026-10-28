"""MISS_CLUSTER: 특정 구간에서 몰려 놓친다.

5초 창을 첫 노트 시각부터 1초씩 옮기며 놓침 비율을 본다. 기준을 넘는 창이 겹치거나 이어지면
한 묶음으로 보고, **묶음마다 놓침 비율이 가장 높은 창 하나**만 쓴다(동률이면 그 창들의 가운데 창,
개수가 짝수면 앞쪽 가운데). 겹친 창을 전부 합치면 구간이 넓어지고 비율이 희석되기 때문이다.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.coach.config import ENABLED_PATTERNS, Thresholds
from ssaplash_ai.coach.notes import NoteTable
from ssaplash_ai.coach.patterns.base import Candidate, clamp01, seconds_text, sorted_pads


def detect_miss_cluster(notes: NoteTable, th: Thresholds) -> list[Candidate]:
    if "MISS_CLUSTER" not in ENABLED_PATTERNS or notes.size == 0:
        return []

    first, last = float(notes.time[0]), float(notes.time[-1])
    steps = int((last - first) // th.cluster_step_ms) + 1
    starts = first + th.cluster_step_ms * np.arange(steps)
    lo = np.searchsorted(notes.time, starts, side="left")
    hi = np.searchsorted(notes.time, starts + th.cluster_window_ms, side="left")
    miss_cumsum = np.concatenate(([0], np.cumsum(notes.miss.astype(int))))

    # (시작, 끝, 놓침 비율, 시작 인덱스, 끝 인덱스) 중 기준을 넘는 창
    windows: list[tuple[float, float, float, int, int]] = []
    for s, a, b in zip(starts, lo, hi, strict=True):
        count = int(b - a)
        if count < th.cluster_min_notes:
            continue
        rate = float(miss_cumsum[b] - miss_cumsum[a]) / count
        if rate >= th.cluster_miss_rate:
            windows.append((float(s), float(s) + th.cluster_window_ms, rate, int(a), int(b)))

    # 겹치거나 이어지는 창끼리 묶는다
    groups: list[list[tuple[float, float, float, int, int]]] = []
    for w in windows:
        if groups and w[0] <= groups[-1][-1][1]:
            groups[-1].append(w)
        else:
            groups.append([w])

    out: list[Candidate] = []
    for group in groups:
        best = max(w[2] for w in group)
        ties = [w for w in group if w[2] == best]
        start, end, rate, a, b = ties[(len(ties) - 1) // 2]
        missed = notes.miss[a:b]
        pads = sorted_pads([p for p, m in zip(notes.pad[a:b], missed, strict=True) if m])
        out.append(
            Candidate(
                pattern="MISS_CLUSTER",
                from_ms=start,
                to_ms=end,
                description=(
                    f"{seconds_text(start)}~{seconds_text(end)}초 구간에서 "
                    f"노트의 {rate * 100:.0f}%를 놓쳤어요."
                ),
                cause_tags=["MISS", "CLUSTER"],
                pads=pads,
                severity=clamp01(rate / th.severity_miss_rate),
                metrics={
                    "severity": 0.0,
                    "missRate": round(rate, 2),
                    "missCount": int(missed.sum()),
                    "noteCount": b - a,
                    "scope": "SEGMENT",
                },
            )
        )
    return out
