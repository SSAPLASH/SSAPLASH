"""LLM 총평 문장(`summary.source=LLM`)의 사실 → 프롬프트 (설계 v0.6).

로컬 오픈소스 모델이 쓴 문장을 그대로 믿지 않는다. 사실(`NarrativeFacts`)에 없는 숫자·패드·비교를 만들거나,
점수·비난 표현, 다른 나라 글자가 섞이면 버리고 호출한 쪽이 규칙 총평을 그대로 쓰게 한다.

이 모듈은 모델을 모른다. `TextGenerator`(문자열 두 개를 받아 문자열을 돌려주는 함수)만 받으므로 시험에서는
가짜 생성기를 쓰고, 실제 모델은 GPU 워커가 같은 모양으로 끼운다. 타격 원본·회원 번호·`playId`는 사실에 없다.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ssaplash_ai.coach.config import MAX_NARRATIVE_CHARS, PAD_LABELS_KO

# 시스템 프롬프트와 사용자 프롬프트를 받아 문장을 돌려주는 함수. 실제 모델은 이 모양으로 끼운다.
TextGenerator = Callable[[str, str], str]

SEVERITY_KO = {"LOW": "조금", "MEDIUM": "보통", "HIGH": "많이"}
LEVEL_KO = {"GOOD": "좋음", "FAIR": "보통", "NEEDS_WORK": "더 연습이 필요함"}
PATTERN_KO = {
    "TIMING_LATE": "곡 전체에서 박보다 늦게 침",
    "TIMING_EARLY": "곡 전체에서 박보다 빠르게 침",
    "PAD_LATE": "특정 패드를 다른 패드보다 늦게 침",
    "PAD_EARLY": "특정 패드를 다른 패드보다 빠르게 침",
    "TRANSITION_LATE": "패드를 옮겨 갈 때 늦게 침",
    "TRANSITION_MISS": "패드를 옮겨 갈 때 놓침",
    "HAND_WEAK": "한쪽 손이 약하게 침",
    "MISS_CLUSTER": "특정 구간에서 놓침이 몰림",
    "UNSTEADY": "박자가 들쭉날쭉함",
}


class Counts(BaseModel):
    model_config = ConfigDict(extra="ignore")

    perfect: int = Field(ge=0)
    good: int = Field(ge=0)
    miss: int = Field(ge=0)

    @property
    def total(self) -> int:
        return self.perfect + self.good + self.miss

    @property
    def miss_rate(self) -> float:
        return self.miss / self.total if self.total else 0.0

    @property
    def perfect_share(self) -> float:
        return self.perfect / self.total if self.total else 0.0


class FactSegment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pattern: str
    severityLevel: Literal["LOW", "MEDIUM", "HIGH"]
    pads: list[str] = []
    fromMs: float
    toMs: float
    scope: Literal["WHOLE", "SEGMENT"]
    metrics: dict[str, float | int | str] = {}


class PreviousPlay(BaseModel):
    model_config = ConfigDict(extra="ignore")

    counts: Counts
    topPatterns: list[str] = Field(default=[], max_length=3)


class History(BaseModel):
    """같은 곡 이전 플레이. BE가 집계해 준다(회원 번호·`playId`는 없다)."""

    model_config = ConfigDict(extra="ignore")

    sameSongPlays: int = Field(ge=1)  # 이번을 뺀 이전 플레이 횟수
    previous: PreviousPlay  # 바로 직전 플레이


class NarrativeFacts(BaseModel):
    """BE가 총평 작업에 담아 주는 사실. 이 밖의 것은 모델에 주지 않는다."""

    model_config = ConfigDict(extra="ignore")

    contractVersion: Literal[1] = 1
    level: Literal["GOOD", "FAIR", "NEEDS_WORK"]
    focusPattern: str | None = None
    counts: Counts
    strengthPad: str | None = None
    segments: list[FactSegment] = Field(default=[], max_length=5)
    history: History | None = None


# ---------- 프롬프트 ----------

SYSTEM_PROMPT = (
    "당신은 초보 드럼 연주자를 가르치는 친절한 드럼 코치입니다. "
    "아래 '사실'만 근거로 연주 리포트 총평을 한국어로 씁니다.\n"
    "규칙:\n"
    "1. 사실에 없는 숫자·패드·곡 정보를 만들지 마세요. 숫자는 사실에 나온 값만 그대로 쓰세요.\n"
    "2. 점수와 정확도는 말하지 마세요.\n"
    "3. 비난하거나 단정하지 말고 격려하는 '~해요' 말투로 쓰세요.\n"
    "4. 순서: 전체 인상 → 잘한 점 → 가장 먼저 연습할 것과 방법 → (지난 연주와의 비교가 사실에 있을 때만) 비교.\n"
    f"5. {MAX_NARRATIVE_CHARS}자 이하의 한 문단. 목록·마크다운·이모지·영어를 쓰지 마세요.\n"
    "총평 문장만 출력하세요."
)


def _pad_ko(pad: str) -> str:
    return PAD_LABELS_KO.get(pad, pad)


def _pct(rate: float) -> int:
    return round(rate * 100)


def build_user_prompt(facts: NarrativeFacts, hint: str | None = None) -> str:
    c = facts.counts
    lines = [
        "사실:",
        f"- 전체 등급: {LEVEL_KO[facts.level]}",
        f"- 판정: 완벽 {c.perfect}개, 좋음 {c.good}개, 놓침 {c.miss}개 (놓침 {_pct(c.miss_rate)}%)",
    ]
    if facts.strengthPad:
        lines.append(f"- 잘한 패드: {_pad_ko(facts.strengthPad)}")
    if not facts.segments:
        lines.append("- 약점: 눈에 띄는 약점 없음")
    for s in facts.segments:
        where = (
            "곡 전체"
            if s.scope == "WHOLE"
            else f"{round(s.fromMs / 1000)}~{round(s.toMs / 1000)}초 구간"
        )
        pads = ", ".join(_pad_ko(p) for p in s.pads) or "패드 지정 없음"
        nums = ", ".join(f"{k}={v}" for k, v in s.metrics.items() if k not in ("severity", "scope"))
        label = PATTERN_KO.get(s.pattern, s.pattern)
        lines.append(
            f"- 약점: {label} / 심각도 {SEVERITY_KO[s.severityLevel]} / {where} / 패드 {pads} / {nums}"
        )
    if facts.focusPattern:
        lines.append(
            f"- 먼저 연습할 약점: {PATTERN_KO.get(facts.focusPattern, facts.focusPattern)}"
        )
    if facts.history:
        p = facts.history.previous.counts
        lines.append(
            f"- 지난 연주(같은 곡 이전 {facts.history.sameSongPlays}번 중 바로 직전): "
            f"완벽 {p.perfect}개, 좋음 {p.good}개, 놓침 {p.miss}개 (놓침 {_pct(p.miss_rate)}%)"
        )
        tops = [PATTERN_KO.get(t, t) for t in facts.history.previous.topPatterns]
        if tops:
            lines.append(f"- 지난 연주의 약점: {', '.join(tops)}")
    else:
        lines.append("- 지난 연주 기록 없음 (비교하지 마세요)")
    if hint:
        lines.append(f"\n이전 시도의 문제: {hint}\n이 문제를 고쳐서 다시 쓰세요.")
    return "\n".join(lines)
