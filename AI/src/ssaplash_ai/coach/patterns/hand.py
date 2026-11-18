"""HAND_WEAK: 한쪽 손(스틱)의 세기가 상대 손보다 약하다.

`stickId`(0/1)가 있고 `velocity`가 있는 유효 타격만 본다. 키보드 입력은 `stickId`가 없어서
자연히 제외된다. `stickId`가 어느 손인지는 문서에 없어서 문구는 "한쪽 손"으로 쓰고,
어느 스틱인지는 `metrics.weakStickId`로 알린다.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.coach.config import ENABLED_PATTERNS, Thresholds
from ssaplash_ai.coach.notes import NoteTable
from ssaplash_ai.coach.patterns.base import Candidate, clamp01, mean_of, sorted_pads, whole_range


def detect_hand_weak(notes: NoteTable, th: Thresholds) -> list[Candidate]:
    if "HAND_WEAK" not in ENABLED_PATTERNS:
        return []
    usable = notes.valid & ~np.isnan(notes.velocity)
    left = usable & (notes.stick == 0)
    right = usable & (notes.stick == 1)
    n0, n1 = int(left.sum()), int(right.sum())
    if n0 < th.hand_min_valid or n1 < th.hand_min_valid:
        return []

    mean0, mean1 = mean_of(notes.velocity[left]), mean_of(notes.velocity[right])
    weak_id, weak_mask, weak_n, strong_n = (
        (0, left, n0, n1) if mean0 < mean1 else (1, right, n1, n0)
    )
    strong_mean = max(mean0, mean1)
    if strong_mean <= 0:
        return []
    ratio = min(mean0, mean1) / strong_mean
    if ratio >= th.hand_ratio_max:
        return []

    start, end = whole_range(notes)
    pads = sorted_pads([p for p, ok in zip(notes.pad, weak_mask, strict=True) if ok])
    return [
        Candidate(
            pattern="HAND_WEAK",
            from_ms=start,
            to_ms=end,
            description=f"{'왼손' if weak_id == 0 else '오른손'}이 다른 손보다 {(1 - ratio) * 100:.0f}% 약하게 쳐요.",
            cause_tags=["WEAK", "HAND"],
            pads=pads,
            severity=clamp01((th.hand_ratio_max - ratio) / th.severity_hand_span),
            metrics={
                "severity": 0.0,
                "velocityRatio": round(ratio, 2),
                "weakStickId": weak_id,
                "weakHitCount": weak_n,
                "strongHitCount": strong_n,
                "scope": "WHOLE",
            },
        )
    ]
