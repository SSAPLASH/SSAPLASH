"""TRANSITION_LATE/MISS: 패드가 바뀔 때(A→B) 늦거나 놓친다.

노트를 시각 순으로 놓고 앞 노트와 패드가 다른 노트를 "전환 노트"로 본다.
같은 (A→B) 전환끼리 모아 그 전환 노트들의 평균 오차와 놓침 비율을 계산한다.
구간은 그 전환이 처음 일어난 곳의 앞 노트 시각부터 마지막 전환 노트 시각 + 1까지다.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from ssaplash_ai.coach.config import ENABLED_PATTERNS, Thresholds
from ssaplash_ai.coach.notes import NoteTable
from ssaplash_ai.coach.patterns.base import Candidate, clamp01, mean_of, pad_label


def detect_transition(notes: NoteTable, th: Thresholds) -> list[Candidate]:
    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i in range(1, notes.size):
        if notes.pad[i] != notes.pad[i - 1]:
            groups[(notes.pad[i - 1], notes.pad[i])].append(i)

    out: list[Candidate] = []
    for (prev_pad, cur_pad), indices in sorted(groups.items()):
        if len(indices) < th.transition_min_count:
            continue
        idx = np.asarray(indices)
        missed = notes.miss[idx]
        miss_rate = float(np.mean(missed))
        valid_idx = idx[~missed]
        start = float(notes.time[idx[0] - 1])
        end = float(notes.time[idx[-1]]) + 1.0
        pair = f"{pad_label(prev_pad)}에서 {pad_label(cur_pad)}로"

        if (
            "TRANSITION_LATE" in ENABLED_PATTERNS
            and valid_idx.size >= th.transition_min_valid
            and mean_of(notes.delta[valid_idx]) >= th.transition_late_ratio * notes.basis(th)
        ):
            mean = mean_of(notes.delta[valid_idx])
            out.append(
                Candidate(
                    pattern="TRANSITION_LATE",
                    from_ms=start,
                    to_ms=end,
                    description=f"{pair} 넘어갈 때 평균 {mean:.0f}ms 늦게 쳐요.",
                    cause_tags=["LATE", "TRANSITION"],
                    pads=[prev_pad, cur_pad],
                    severity=clamp01(mean / (th.severity_delta_ratio * notes.basis(th))),
                    metrics={
                        "severity": 0.0,
                        "meanDeltaMs": round(mean, 1),
                        "hitCount": int(valid_idx.size),
                        "transitionCount": len(indices),
                        "scope": "SEGMENT",
                    },
                )
            )

        if "TRANSITION_MISS" in ENABLED_PATTERNS and miss_rate >= th.transition_miss_rate:
            out.append(
                Candidate(
                    pattern="TRANSITION_MISS",
                    from_ms=start,
                    to_ms=end,
                    description=f"{pair} 넘어갈 때 {miss_rate * 100:.0f}%를 놓쳐요.",
                    cause_tags=["MISS", "TRANSITION"],
                    pads=[prev_pad, cur_pad],
                    severity=clamp01(miss_rate / th.severity_miss_rate),
                    metrics={
                        "severity": 0.0,
                        "missRate": round(miss_rate, 2),
                        "missCount": int(missed.sum()),
                        "transitionCount": len(indices),
                        "scope": "SEGMENT",
                    },
                )
            )
    return out
