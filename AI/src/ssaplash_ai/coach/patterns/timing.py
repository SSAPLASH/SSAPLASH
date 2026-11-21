"""TIMING_LATE/EARLY(전체적으로 늦거나 빠르다), PAD_LATE/EARLY(특정 패드가 늦거나 빠르다).

둘 다 유효 타격(PERFECT/GOOD)의 오차 `deltaMs`(양수 늦음, 음수 빠름) 평균을 본다.
오차는 판정 폭 안에 갇힌 값이라(폭을 넘으면 놓침) 평균이 실제 지연보다 작게 나올 수 있고,
그 부분은 놓침 계열 패턴이 보완한다.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.coach.config import ENABLED_PATTERNS, Thresholds
from ssaplash_ai.coach.notes import NoteTable
from ssaplash_ai.coach.patterns.base import (
    Candidate,
    clamp01,
    mean_of,
    pad_label,
    sorted_pads,
    whole_range,
)


def detect_timing(notes: NoteTable, th: Thresholds) -> list[Candidate]:
    delta = notes.delta[notes.valid]
    if delta.size < th.timing_min_valid:
        return []
    mean = mean_of(delta)
    late = mean > 0
    pattern = "TIMING_LATE" if late else "TIMING_EARLY"
    if pattern not in ENABLED_PATTERNS:
        return []
    if abs(mean) < th.timing_mean_ratio * notes.basis(th):
        return []
    same_sign = float(np.mean(np.sign(delta) == (1 if late else -1)))
    if same_sign < th.timing_same_sign:
        return []
    if th.timing_min_se > 0:
        standard_error = float(np.std(delta, ddof=1)) / float(np.sqrt(delta.size))
        if abs(mean) < th.timing_min_se * standard_error:
            return []

    start, end = whole_range(notes)
    pads = sorted_pads([p for p, ok in zip(notes.pad, notes.valid, strict=True) if ok])
    return [
        Candidate(
            pattern=pattern,
            from_ms=start,
            to_ms=end,
            description=f"전체적으로 평균 {abs(mean):.0f}ms {'늦게' if late else '빠르게'} 치고 있어요.",
            cause_tags=["LATE" if late else "EARLY", "OVERALL"],
            pads=pads,
            severity=clamp01(abs(mean) / (th.severity_delta_ratio * notes.basis(th))),
            metrics={
                "severity": 0.0,  # 응답 조립 때 채운다
                "meanDeltaMs": round(mean, 1),
                "hitCount": int(delta.size),
                "scope": "WHOLE",
            },
        )
    ]


def detect_pad_timing(notes: NoteTable, th: Thresholds) -> list[Candidate]:
    valid = notes.valid
    if int(valid.sum()) == 0:
        return []
    overall = mean_of(notes.delta[valid])
    pad_array = np.asarray(notes.pad)
    start, end = whole_range(notes)

    out: list[Candidate] = []
    for pad in sorted(set(pad_array[valid].tolist())):
        delta = notes.delta[valid & (pad_array == pad)]
        if delta.size < th.pad_min_valid:
            continue
        mean = mean_of(delta)
        gap = mean - overall
        if abs(mean) < th.pad_mean_ratio * notes.basis(th):
            continue
        if abs(gap) < th.pad_gap_ratio * notes.basis(th):
            continue
        # 이 패드가 다른 패드보다 더 늦거나(빠른) 경우만 낸다. 전체보다 덜 늦은 패드는 약점이 아니다.
        if (mean > 0) != (gap > 0):
            continue
        late = mean > 0
        pattern = "PAD_LATE" if late else "PAD_EARLY"
        if pattern not in ENABLED_PATTERNS:
            continue
        out.append(
            Candidate(
                pattern=pattern,
                from_ms=start,
                to_ms=end,
                description=(
                    f"{pad_label(pad)}에서 평균 {abs(mean):.0f}ms {'늦게' if late else '빠르게'} 쳐요."
                ),
                cause_tags=["LATE" if late else "EARLY", "PAD"],
                pads=[pad],
                severity=clamp01(abs(mean) / (th.severity_delta_ratio * notes.basis(th))),
                metrics={
                    "severity": 0.0,
                    "meanDeltaMs": round(mean, 1),
                    "overallMeanDeltaMs": round(overall, 1),
                    "hitCount": int(delta.size),
                    "scope": "WHOLE",
                },
            )
        )
    return out
