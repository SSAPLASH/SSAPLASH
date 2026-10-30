"""평가 시나리오: 무엇을 심고(연주 모델), 무엇이 나와야 하는지(정답)를 정의한다.

강도는 모두 `goodMs`에 대한 비율이다. 강도 단계는 규칙 임계값 아래·근처·위를 모두 지나도록 잡았지만
규칙 임계값을 코드에서 읽지 않는다(순환 검증 방지). 임계값과의 관계는 결과 문서에서 해석한다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from ssaplash_ai.coach_eval.chart import Note
from ssaplash_ai.coach_eval.player import PlayerModel

# 무작위 놓침·여분 타격의 기본 수준. 심은 약점이 아니라 평소 연주다.
BASE = PlayerModel()

# 약점이 없는 정상 연주의 숙련도 3단계 (가정값, 실제 로그로 보정한다)
SKILLS: dict[str, PlayerModel] = {
    "CLEAN_EXPERT": PlayerModel(sigma=0.12, p_miss=0.01, p_stray=0.01, velocity_sd=8.0),
    "CLEAN_AVERAGE": PlayerModel(sigma=0.25, p_miss=0.04, p_stray=0.02),
    "CLEAN_NOVICE": PlayerModel(sigma=0.35, p_miss=0.08, p_stray=0.04, velocity_sd=14.0),
}

TARGET_PAD = "SNARE"
TRANSITION = ("HIHAT", "SNARE")
CLUSTER_LENGTH_MS = 6000.0


@dataclass(frozen=True)
class Truth:
    """한 번의 시험에서 분석이 내놓아야 하는 것."""

    expected: tuple[str, ...]  # 이 중 하나라도 나오면 탐지
    pads: tuple[str, ...] = ()  # 응답 `pads[]`가 모두 포함해야 하는 패드
    span: tuple[float, float] | None = None  # 구간형(SEGMENT)이면 심은 구간 [시작, 끝) ms
    allowed_extra: frozenset[str] = frozenset()  # 함께 나와도 교차 반응으로 세지 않는 pattern


@dataclass(frozen=True)
class Scenario:
    name: str
    kind: str  # PLANTED | CLEAN
    layout: str
    strengths: tuple[float, ...]
    strength_unit: str
    build: Callable[[float, list[Note]], PlayerModel]
    truth: Callable[[float, list[Note]], Truth] = field(default=lambda s, c: Truth(expected=()))


def _span(chart: list[Note]) -> tuple[float, float]:
    return chart[0].time_ms, chart[-1].time_ms + 1


def _cluster_range(chart: list[Note]) -> tuple[float, float]:
    """구간이 곡 40% 지점에서 시작해 6초 이어진다."""
    start = chart[int(len(chart) * 0.4)].time_ms
    return start, start + CLUSTER_LENGTH_MS


def _timing(sign: int, pattern: str) -> Scenario:
    return Scenario(
        name=pattern,
        kind="PLANTED",
        layout="rock",
        strengths=(0.15, 0.25, 0.4, 0.6),
        strength_unit="평균 오차(× goodMs)",
        build=lambda s, c: PlayerModel(mean=sign * s, sigma=0.2),
        truth=lambda s, c: Truth(expected=(pattern,)),
    )


def _pad(sign: int, pattern: str) -> Scenario:
    return Scenario(
        name=pattern,
        kind="PLANTED",
        layout="random",  # 정해진 주기가 없어야 패드 약점과 전환 약점이 섞이지 않는다
        strengths=(0.25, 0.4, 0.6, 0.9),
        strength_unit=f"{TARGET_PAD} 평균 오차(× goodMs)",
        build=lambda s, c: PlayerModel(pad_shift={TARGET_PAD: sign * s}, sigma=0.2),
        truth=lambda s, c: Truth(expected=(pattern,), pads=(TARGET_PAD,)),
    )


SCENARIOS: tuple[Scenario, ...] = (
    _timing(+1, "TIMING_LATE"),
    _timing(-1, "TIMING_EARLY"),
    _pad(+1, "PAD_LATE"),
    _pad(-1, "PAD_EARLY"),
    Scenario(
        name="TRANSITION_LATE",
        kind="PLANTED",
        layout="mixed",
        strengths=(0.3, 0.5, 0.7, 1.0),
        strength_unit="전환 직후 추가 오차(× goodMs)",
        build=lambda s, c: PlayerModel(transition=TRANSITION, transition_shift=s, sigma=0.2),
        # 전환 직후 스네어는 스네어의 절반이라 큰 강도에서는 패드 지연으로도 잡힌다
        truth=lambda s, c: Truth(
            expected=("TRANSITION_LATE",),
            pads=TRANSITION,
            span=_span(c),
            allowed_extra=frozenset({"PAD_LATE"}),
        ),
    ),
    Scenario(
        name="TRANSITION_MISS",
        kind="PLANTED",
        layout="mixed",
        strengths=(0.2, 0.35, 0.5, 0.7),
        strength_unit="전환 직후 놓침 확률",
        build=lambda s, c: PlayerModel(transition=TRANSITION, transition_p_miss=s, sigma=0.2),
        truth=lambda s, c: Truth(expected=("TRANSITION_MISS",), pads=TRANSITION, span=_span(c)),
    ),
    Scenario(
        name="HAND_WEAK",
        kind="PLANTED",
        layout="rock",
        strengths=(0.9, 0.8, 0.7, 0.55),
        strength_unit="약한 손 세기 비율",
        build=lambda s, c: PlayerModel(weak_stick=0, weak_ratio=s, velocity_sd=8.0),
        truth=lambda s, c: Truth(expected=("HAND_WEAK",)),
    ),
    Scenario(
        name="MISS_CLUSTER",
        kind="PLANTED",
        layout="rock",
        strengths=(0.2, 0.4, 0.6, 0.9),
        strength_unit="구간 놓침 확률",
        build=lambda s, c: PlayerModel(cluster=_cluster_range(c), cluster_p_miss=s),
        truth=lambda s, c: Truth(
            expected=("MISS_CLUSTER",),
            span=_cluster_range(c),
            # 몰린 놓침이 전환·패드 통계에도 번질 수 있다
            allowed_extra=frozenset({"TRANSITION_MISS"}),
        ),
    ),
    Scenario(
        name="UNSTEADY",
        kind="PLANTED",
        layout="rock",
        strengths=(0.3, 0.4, 0.55, 0.75),
        strength_unit="오차 표준편차(× goodMs, 판정 폭에서 잘리기 전)",
        build=lambda s, c: PlayerModel(sigma=s),
        truth=lambda s, c: Truth(expected=("UNSTEADY",)),
    ),
    *(
        Scenario(
            name=name,
            kind="CLEAN",
            layout="rock",
            strengths=(0.0,),
            strength_unit="—",
            build=lambda s, c, model=model: model,
        )
        for name, model in SKILLS.items()
    ),
)

SCENARIOS_BY_NAME = {s.name: s for s in SCENARIOS}
PLANTED = tuple(s for s in SCENARIOS if s.kind == "PLANTED")
CLEAN = tuple(s for s in SCENARIOS if s.kind == "CLEAN")
