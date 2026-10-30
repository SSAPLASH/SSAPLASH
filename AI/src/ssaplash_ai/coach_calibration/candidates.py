"""임계값 후보 생성과 what-if.

각 그룹의 임계값 하나(knob)를 현재 값의 0.5~1.5배로 바꿔 가며 같은 세션에 다시 분석해서 걸림 비율이 어떻게 변하는지(what-if) 본다.
정책(`policy.py`)에 목표 범위가 있는 그룹은, 현재 값에서 `max_change` 안에서 목표 범위에 들어오는 값 중 **현재 값에 가장 가까운 것**을 후보로 낸다.
후보는 제안일 뿐이다. 적용은 사람이 승인한 뒤 `config.py`를 고치는 MR로 한다.

표본이 `min_sample`보다 적으면 후보도 what-if도 만들지 않는다(작은 표본의 비율은 믿기 어렵다).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from ssaplash_ai.coach import AnalysisRequest
from ssaplash_ai.coach.analyzer import analyze_notes
from ssaplash_ai.coach.config import DEFAULT_THRESHOLDS, Thresholds
from ssaplash_ai.coach.notes import NoteTable, build_notes
from ssaplash_ai.coach.schema import AnalysisResponse
from ssaplash_ai.coach_calibration.policy import Policy
from ssaplash_ai.coach_calibration.profile import FlagRate, flag_record
from ssaplash_ai.coach_calibration.source import Session
from ssaplash_ai.coach_eval.metrics import summarize
from ssaplash_ai.coach_eval.runner import RunConfig, run_all

CANDIDATES_VERSION = "candidates-1"
REEVAL_CONFIG = RunConfig(seeds=30)  # 후보 재평가에 쓰는 합성 평가 규모(139 도구)

# 전체 상태
INSUFFICIENT_SAMPLE = "INSUFFICIENT_SAMPLE"
OK = "OK"
# 그룹 상태
NO_TARGET = "NO_TARGET"  # 정책에 이 그룹의 목표 범위가 없다
KEEP = "KEEP"  # 현재 걸림 비율이 목표 범위 안이다
CHANGE = "CHANGE"  # 범위 안에서 목표 범위에 들어오는 값을 찾았다
OUT_OF_REACH = "OUT_OF_REACH"  # 허용된 변경 폭 안에서는 목표 범위에 닿지 못한다

GRID_STEP = 0.05
GRID_LOW, GRID_HIGH = 0.5, 1.5
EPS = 1e-9


@dataclass(frozen=True)
class Knob:
    group: str
    field: str  # `Thresholds`의 필드 이름
    patterns: tuple[str, ...]  # 이 임계값이 좌우하는 pattern
    raises_flags: bool  # 값을 키우면 걸림이 늘어나는가(손 세기 비율만 그렇다)


KNOBS = (
    Knob("TIMING", "timing_mean_ratio", ("TIMING_LATE", "TIMING_EARLY"), False),
    Knob("PAD", "pad_mean_ratio", ("PAD_LATE", "PAD_EARLY"), False),
    Knob("TRANSITION_LATE", "transition_late_ratio", ("TRANSITION_LATE",), False),
    Knob("TRANSITION_MISS", "transition_miss_rate", ("TRANSITION_MISS",), False),
    Knob("HAND_WEAK", "hand_ratio_max", ("HAND_WEAK",), True),
    Knob("MISS_CLUSTER", "cluster_miss_rate", ("MISS_CLUSTER",), False),
    Knob("UNSTEADY", "unsteady_std_ratio", ("UNSTEADY",), False),
)
GROUPS = frozenset(k.group for k in KNOBS)


@dataclass(frozen=True)
class WhatIf:
    multiplier: float
    value: float
    rate: FlagRate


@dataclass(frozen=True)
class Choice:
    status: str
    chosen: WhatIf | None  # CHANGE면 후보, OUT_OF_REACH면 None
    nearest: WhatIf | None  # OUT_OF_REACH일 때 목표에 가장 가까운 점(참고용)


@dataclass
class GroupCandidate:
    group: str
    field: str
    current_value: float
    current: FlagRate
    target: tuple[float, float] | None
    status: str
    candidate: WhatIf | None = None
    nearest: WhatIf | None = None
    what_if: list[WhatIf] = field(default_factory=list)


@dataclass
class CandidateReport:
    status: str
    n_sessions: int
    groups: list[GroupCandidate] = field(default_factory=list)
    thresholds: Thresholds | None = None  # CHANGE가 있을 때만: 현재 값에 후보를 반영한 임계값

    def changed(self) -> dict[str, float]:
        return {g.field: g.candidate.value for g in self.groups if g.candidate is not None}

    def to_record(self) -> dict[str, Any]:
        """기록용. 걸림 1~4건은 `flag_record`가 가린다."""
        return {
            "status": self.status,
            "nSessions": self.n_sessions,
            "version": CANDIDATES_VERSION,
            "changed": self.changed(),
            "groups": {g.group: _group_record(g) for g in self.groups},
        }


def _group_record(g: GroupCandidate) -> dict[str, Any]:
    return {
        "field": g.field,
        "currentValue": g.current_value,
        "current": flag_record(g.current),
        "target": list(g.target) if g.target else None,
        "status": g.status,
        "candidateValue": g.candidate.value if g.candidate else None,
        "candidate": flag_record(g.candidate.rate) if g.candidate else None,
        "nearest": (
            {"value": g.nearest.value, "rate": flag_record(g.nearest.rate)} if g.nearest else None
        ),
        "whatIf": [
            {"multiplier": w.multiplier, "value": w.value, "rate": flag_record(w.rate)}
            for w in g.what_if
        ],
    }


def choose_candidate(
    current_rate: float, points: Sequence[WhatIf], target: tuple[float, float], max_change: float
) -> Choice:
    """목표 범위에 들어오는 값 중 현재 값에 가장 가까운 것을 고른다(순수 함수).

    현재 걸림 비율이 이미 범위 안이면 바꾸지 않는다(`KEEP`). 허용된 변경 폭(`max_change`) 안에서 범위에 못 닿으면
    `OUT_OF_REACH`이고, 그때는 목표에 가장 가까운 점을 참고로 돌려준다.
    """
    low, high = target
    if low <= current_rate <= high:
        return Choice(KEEP, None, None)

    def change(p: WhatIf) -> float:
        # 0.9배와 1.1배의 변경 폭이 부동소수점 때문에 달라 보이지 않게 반올림해서 비교한다
        return round(abs(p.multiplier - 1.0), 6)

    reachable = [p for p in points if change(p) <= max_change + EPS]
    center = (low + high) / 2
    inside = [p for p in reachable if low <= p.rate.rate <= high]
    if inside:
        best = min(inside, key=lambda p: (change(p), abs(p.rate.rate - center)))
        return Choice(CHANGE, best, None)

    def distance(p: WhatIf) -> float:
        return max(low - p.rate.rate, 0.0) + max(p.rate.rate - high, 0.0)

    nearest = min(reachable, key=lambda p: (round(distance(p), 6), change(p)), default=None)
    return Choice(OUT_OF_REACH, None, nearest)


def prepare_notes(sessions: Sequence[Session]) -> list[NoteTable]:
    """세션마다 노트 표를 한 번만 만들어 두고 임계값만 바꿔 여러 번 분석한다."""
    return [build_notes(AnalysisRequest.model_validate(s.to_request())) for s in sessions]


def analyze_prepared(notes: Sequence[NoteTable], thresholds: Thresholds) -> list[AnalysisResponse]:
    return [analyze_notes(n, thresholds) for n in notes]


def group_rate(responses: Sequence[AnalysisResponse], patterns: Sequence[str]) -> FlagRate:
    """그룹에 속한 pattern 중 하나라도 걸린 세션을 센다(세션당 한 번)."""
    wanted = set(patterns)
    flagged = sum(any(seg.pattern in wanted for seg in r.weakSegments) for r in responses)
    return FlagRate("+".join(patterns), flagged, len(responses))


def _multipliers(max_change: float) -> list[float]:
    """what-if로 볼 배율. 허용 변경 폭 바깥도 참고로 포함하되 0.5~1.5배로 제한한다."""
    steps = round((GRID_HIGH - GRID_LOW) / GRID_STEP)
    grid = [round(GRID_LOW + GRID_STEP * i, 2) for i in range(steps + 1)]
    return [m for m in grid if abs(m - 1.0) <= max(max_change, 0.0) + 0.25 + EPS]


def _value_for(knob: Knob, base: Thresholds, multiplier: float) -> float:
    raw = getattr(base, knob.field) * multiplier
    return round(min(max(raw, 0.01), 0.99), 3)


def build_report(
    sessions: Sequence[Session],
    policy: Policy,
    base: Thresholds = DEFAULT_THRESHOLDS,
) -> CandidateReport:
    """드럼 세션에 대해 what-if 표와 후보를 만든다(키보드는 시험용이라 후보에 쓰지 않는다)."""
    n = len(sessions)
    if n < policy.min_sample:
        return CandidateReport(status=INSUFFICIENT_SAMPLE, n_sessions=n)

    notes = prepare_notes(sessions)
    baseline = analyze_prepared(notes, base)
    groups: list[GroupCandidate] = []
    for knob in KNOBS:
        current_value = getattr(base, knob.field)
        current = group_rate(baseline, knob.patterns)
        points: list[WhatIf] = []
        seen: set[float] = set()
        for m in _multipliers(policy.max_change):
            value = current_value if m == 1.0 else _value_for(knob, base, m)
            if value in seen:
                continue
            seen.add(value)
            responses = (
                baseline
                if m == 1.0
                else analyze_prepared(notes, replace(base, **{knob.field: value}))
            )
            points.append(WhatIf(m, value, group_rate(responses, knob.patterns)))

        target = policy.target_of(knob.group)
        candidate = GroupCandidate(
            group=knob.group,
            field=knob.field,
            current_value=current_value,
            current=current,
            target=target,
            status=NO_TARGET,
            what_if=points,
        )
        if target is not None:
            choice = choose_candidate(current.rate, points, target, policy.max_change)
            candidate.status = choice.status
            candidate.candidate = choice.chosen
            candidate.nearest = choice.nearest
        groups.append(candidate)

    report = CandidateReport(status=OK, n_sessions=n, groups=groups)
    changes = report.changed()
    report.thresholds = replace(base, **changes) if changes else None
    return report


# --- 후보를 139 도구(합성 평가)로 다시 평가 ---


@dataclass(frozen=True)
class ReevalRow:
    scenario: str
    kind: str
    strength: float
    baseline: float  # PLANTED는 탐지율, CLEAN은 오탐률
    candidate: float


@dataclass
class Reeval:
    rows: list[ReevalRow]

    def worst_recall_drop(self) -> float:
        """약점을 심은 칸 중 탐지율이 가장 많이 떨어진 크기(떨어지지 않았으면 0)."""
        drops = [r.baseline - r.candidate for r in self.rows if r.kind == "PLANTED"]
        return max([0.0, *drops])

    def worst_fp_rise(self) -> float:
        """정상 칸 중 오탐률이 가장 많이 오른 크기(오르지 않았으면 0)."""
        rises = [r.candidate - r.baseline for r in self.rows if r.kind == "CLEAN"]
        return max([0.0, *rises])

    def to_record(self) -> dict[str, Any]:
        return {
            "worstRecallDrop": round(self.worst_recall_drop(), 4),
            "worstFpRise": round(self.worst_fp_rise(), 4),
            "rows": [
                {
                    "scenario": r.scenario,
                    "strength": r.strength,
                    "baseline": round(r.baseline, 4),
                    "candidate": round(r.candidate, 4),
                }
                for r in self.rows
            ],
        }


def reevaluate(
    candidate: Thresholds,
    config: RunConfig = REEVAL_CONFIG,
    base: Thresholds = DEFAULT_THRESHOLDS,
) -> Reeval:
    """같은 합성 로그(같은 시드)에 현재 임계값과 후보 임계값을 각각 돌려 비교한다."""
    before = {
        (c.scenario, c.strength): c for c in summarize(run_all(config, thresholds=base).trials)
    }
    after = summarize(run_all(config, thresholds=candidate).trials)
    rows = []
    for c in after:
        b = before[(c.scenario, c.strength)]
        if c.kind == "CLEAN":
            rows.append(ReevalRow(c.scenario, c.kind, c.strength, b.fp_rate, c.fp_rate))
        else:
            rows.append(
                ReevalRow(c.scenario, c.kind, c.strength, b.detection_rate, c.detection_rate)
            )
    return Reeval(rows)
