"""UNSTEADY: 박자가 들쭉날쭉하다 (오차의 표준편차가 크다).

기준은 0.5 × 기준 폭(기본 고정 60ms라 30ms)이다. 기준 폭 안에서 고르게 흩어지면 표준편차가 폭의 약 0.58배이므로,
그 수준이면 걸리고 안정된 연주는 걸리지 않는다.

**한계:** 판정 폭을 벗어난 타격은 MISS가 되어 오차가 남지 않는다. 그래서 판정 폭이 좁은 사용자는 표준편차가 기준에
닿기 어렵다(판정 폭 30ms면 표준편차가 30ms를 넘을 수 없다). 자세한 내용은 `docs/coach-weak-segments.md` "기준 폭" 절.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.coach.config import ENABLED_PATTERNS, Thresholds
from ssaplash_ai.coach.notes import NoteTable
from ssaplash_ai.coach.patterns.base import Candidate, clamp01, sorted_pads, whole_range


def detect_unsteady(notes: NoteTable, th: Thresholds) -> list[Candidate]:
    if "UNSTEADY" not in ENABLED_PATTERNS:
        return []
    delta = notes.delta[notes.valid]
    if delta.size < th.unsteady_min_valid:
        return []
    std = float(np.std(delta))  # 모집단 표준편차
    if std < th.unsteady_std_ratio * notes.basis(th):
        return []

    start, end = whole_range(notes)
    pads = sorted_pads([p for p, ok in zip(notes.pad, notes.valid, strict=True) if ok])
    return [
        Candidate(
            pattern="UNSTEADY",
            from_ms=start,
            to_ms=end,
            description=f"박자가 들쭉날쭉해요(편차 {std:.0f}ms).",
            cause_tags=["UNSTEADY", "OVERALL"],
            pads=pads,
            severity=clamp01(std / (th.severity_unsteady_ratio * notes.basis(th))),
            metrics={
                "severity": 0.0,
                "stdDeltaMs": round(std, 1),
                "hitCount": int(delta.size),
                "scope": "WHOLE",
            },
        )
    ]
