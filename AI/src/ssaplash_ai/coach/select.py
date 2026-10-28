"""후보 중복 정리와 선택.

1. 같은 패턴·같은 구간·같은 패드 후보가 여러 번 잡히면 `severity`가 큰 하나만 남긴다.
2. `severity` 내림차순으로 최대 5개(같은 `pattern`은 2개까지) 고른다.
3. 고른 것을 `fromMs` 오름차순으로 정렬해 돌려준다(BE가 시간순을 요구한다).
정렬 기준에 `pattern`·구간을 넣어 같은 입력이 항상 같은 출력이 되게 한다.
"""

from __future__ import annotations

from collections import Counter

from ssaplash_ai.coach.config import MAX_PER_PATTERN, MAX_RESULTS
from ssaplash_ai.coach.patterns.base import Candidate


def select_candidates(
    candidates: list[Candidate],
    max_results: int = MAX_RESULTS,
    max_per_pattern: int = MAX_PER_PATTERN,
) -> list[Candidate]:
    unique: dict[tuple[str, float, float, tuple[str, ...]], Candidate] = {}
    for c in candidates:
        key = (c.pattern, c.from_ms, c.to_ms, tuple(c.pads))
        if key not in unique or c.severity > unique[key].severity:
            unique[key] = c

    ranked = sorted(unique.values(), key=lambda c: (-c.severity, c.pattern, c.from_ms, c.to_ms))
    per_pattern: Counter[str] = Counter()
    chosen: list[Candidate] = []
    for c in ranked:
        if len(chosen) >= max_results:
            break
        if per_pattern[c.pattern] >= max_per_pattern:
            continue
        per_pattern[c.pattern] += 1
        chosen.append(c)

    return sorted(chosen, key=lambda c: (c.from_ms, -c.severity, c.pattern))
