"""분석 결과와 정답 비교, 탐지율·오탐률 집계."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from ssaplash_ai.coach.schema import AnalysisResponse
from ssaplash_ai.coach_eval.scenarios import Scenario, Truth

IOU_MIN = 0.5  # 위치 일치로 보는 최소 겹침(교집합 ÷ 합집합)


@dataclass(frozen=True)
class Trial:
    """한 번의 시험 결과."""

    scenario: str
    kind: str
    strength: float
    patterns: tuple[str, ...]  # 응답에 나온 pattern 전부
    detected: bool = False
    location_ok: bool | None = None  # 구간형이 아니면 None
    pads_ok: bool | None = None  # 기대 패드가 없으면 None
    cross: tuple[str, ...] = ()  # 기대 밖 pattern (교차 반응)
    allowed: tuple[str, ...] = ()  # 허용 목록에 있어 따로 표시만 하는 pattern
    false_positive: bool = False  # 정상 로그에서 약점이 하나라도 나왔는가


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """윌슨 구간(95%). n이 0이면 (0, 1)."""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - half), min(1.0, center + half)


def iou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = (a[1] - a[0]) + (b[1] - b[0]) - inter
    return inter / union if union > 0 else 0.0


def evaluate(
    response: AnalysisResponse, scenario: Scenario, strength: float, truth: Truth
) -> Trial:
    patterns = tuple(seg.pattern for seg in response.weakSegments)
    base = dict(scenario=scenario.name, kind=scenario.kind, strength=strength, patterns=patterns)

    if scenario.kind == "CLEAN":
        return Trial(**base, false_positive=bool(patterns))

    matches = [seg for seg in response.weakSegments if seg.pattern in truth.expected]
    extras = [p for p in patterns if p not in truth.expected]
    return Trial(
        **base,
        detected=bool(matches),
        location_ok=(
            any(iou((s.fromMs, s.toMs), truth.span) >= IOU_MIN for s in matches)
            if matches and truth.span
            else (False if truth.span else None)
        ),
        pads_ok=(any(set(truth.pads) <= set(s.pads) for s in matches) if truth.pads else None),
        cross=tuple(p for p in extras if p not in truth.allowed_extra),
        allowed=tuple(p for p in extras if p in truth.allowed_extra),
    )


@dataclass
class Cell:
    """시나리오·강도 한 칸의 집계."""

    scenario: str
    kind: str
    strength: float
    n: int = 0
    detected: int = 0
    location_ok: int = 0
    location_n: int = 0
    pads_ok: int = 0
    pads_n: int = 0
    false_positive: int = 0
    pattern_counts: Counter = field(default_factory=Counter)  # 나온 pattern별 시험 수
    cross_counts: Counter = field(default_factory=Counter)
    allowed_counts: Counter = field(default_factory=Counter)

    @property
    def detection_rate(self) -> float:
        return self.detected / self.n if self.n else 0.0

    @property
    def detection_ci(self) -> tuple[float, float]:
        return wilson(self.detected, self.n)

    @property
    def fp_rate(self) -> float:
        return self.false_positive / self.n if self.n else 0.0

    @property
    def fp_ci(self) -> tuple[float, float]:
        return wilson(self.false_positive, self.n)


def summarize(trials: list[Trial]) -> list[Cell]:
    """(시나리오, 강도) 칸별로 집계한다. 입력 순서대로 칸이 처음 나온 순서를 유지한다."""
    cells: dict[tuple[str, float], Cell] = {}
    for t in trials:
        cell = cells.setdefault((t.scenario, t.strength), Cell(t.scenario, t.kind, t.strength))
        cell.n += 1
        cell.detected += t.detected
        cell.false_positive += t.false_positive
        if t.location_ok is not None and t.detected:
            cell.location_n += 1
            cell.location_ok += t.location_ok
        if t.pads_ok is not None and t.detected:
            cell.pads_n += 1
            cell.pads_ok += t.pads_ok
        cell.pattern_counts.update(set(t.patterns))
        cell.cross_counts.update(set(t.cross))
        cell.allowed_counts.update(set(t.allowed))
    return list(cells.values())


def false_positive_by_pattern(cells: list[Cell]) -> dict[str, tuple[int, int]]:
    """정상 로그에서 pattern별로 (나온 시험 수, 전체 시험 수)."""
    hits: dict[str, int] = defaultdict(int)
    total = 0
    for c in cells:
        if c.kind != "CLEAN":
            continue
        total += c.n
        for pattern, count in c.pattern_counts.items():
            hits[pattern] += count
    return {p: (k, total) for p, k in sorted(hits.items())}
