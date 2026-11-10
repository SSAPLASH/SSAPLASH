"""연주 중 LLM 구간 코칭: 구간 사실 → 프롬프트 → 가드레일 (설계 COACH-001 연주 중 LLM 코칭 3.2, 3.5).

4·8·16마디 구간이 끝날 때 FE가 만든 구간 사실(`LiveSegmentFacts`)로 안내 칸 한 장(제목 8자, 보조 16자)을 쓴다.
모델은 리포트 총평과 같은 로컬 모델이고, 이 모듈은 모델을 모른다(`TextGenerator`만 받는다).
가드레일은 리포트 총평(`narrative.py`)의 금지어·특수 토큰·외국 글자 검사를 함께 쓰고, 안내 칸 원칙(숫자 없음,
짧은 길이, 키보드면 스틱 표현 없음, 사실에 없는 패드 없음, 직전 문구 반복 없음)을 더한다.
하나라도 어기면 그 구간은 LLM 문구 없이 규칙 코칭만 쓴다. 타격 원본·회원 번호·`playId`·곡 정보는 사실에 없다.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ssaplash_ai.coach.narrative import (
    _FOREIGN,
    _MARKUP,
    FORBIDDEN_WORDS,
    TextGenerator,
    clean,
)

CONTRACT_VERSION = 1
MAX_TITLE = 8
MAX_SUB = 16

# 화면 키트와 같은 패드 이름(FE `padName.ts`의 coachPadName). 리포트는 스몰탐·미드탐이지만 연주 중에는 탐1·탐2다
LIVE_PAD_KO = {
    "CRASH": "크래시",
    "HIHAT": "하이햇",
    "SNARE": "스네어",
    "SMALL_TOM": "탐1",
    "MID_TOM": "탐2",
    "FLOOR_TOM": "플로어탐",
    "RIDE": "라이드",
    "KICK": "킥",
    "HIHAT_PEDAL": "하이햇 페달",
}
# 박의 기준으로 말할 수 있는 소리(예: "킥에 맞춰요"). 약점 패드가 아니어도 써도 된다
ANCHOR_PADS = ("KICK",)
TAG_KO = {
    "LIVE_PAD_MISS": "한 패드를 자주 놓침",
    "LIVE_MISS_STREAK": "연달아 놓침",
    "LIVE_LATE": "계속 늦게 침",
    "LIVE_EARLY": "계속 빠르게 침",
    "LIVE_PAD_LATE": "한 패드만 늦게 침",
    "LIVE_PAD_EARLY": "한 패드만 빠르게 침",
    "LIVE_HAND_WEAK": "한 손이 약함",
    "LIVE_UNSTEADY": "박자가 들쭉날쭉함",
}
CAUSE_KO = {
    "WRONG_PAD": "다른 패드를 침",
    "TRANSITION": "패드를 옮기다 놓침",
    "DENSE": "빠른 구간에서 놓침",
    "DRIFT_LATE": "점점 늦어지다 놓침",
}
# 키보드 입력에서는 쓸 수 없는 스틱 전용 표현
_STICK_WORDS = ("스틱", "손목", "떨궈", "떨어뜨", "팔 힘", "팔로")
_DIGIT = re.compile(r"\d")
_JSON = re.compile(r"\{.*?\}", re.DOTALL)


class SegmentRange(BaseModel):
    model_config = ConfigDict(extra="ignore")
    index: int = Field(ge=0)
    fromBar: int = Field(ge=1)
    toBar: int = Field(ge=1)


class LiveCounts(BaseModel):
    model_config = ConfigDict(extra="ignore")
    perfect: int = Field(ge=0)
    good: int = Field(ge=0)
    miss: int = Field(ge=0)


class LiveTiming(BaseModel):
    model_config = ConfigDict(extra="ignore")
    meanDeltaMs: float | None = None
    stdDeltaMs: float | None = None
    sameSignRatio: float | None = Field(default=None, ge=0, le=1)


class LivePad(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pad: str
    notes: int = Field(ge=0)
    misses: int = Field(ge=0)
    meanDeltaMs: float | None = None


class LiveHands(BaseModel):
    model_config = ConfigDict(extra="ignore")
    weakHand: Literal["LEFT", "RIGHT"] | None = None
    ratio: float | None = Field(default=None, ge=0, le=1)


class RuleCoach(BaseModel):
    model_config = ConfigDict(extra="ignore")
    tags: list[str] = Field(default_factory=list, max_length=8)
    causes: list[str] = Field(default_factory=list, max_length=8)


class LiveTip(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(max_length=40)
    sub: str = Field(default="", max_length=60)


class PreviousSegment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    counts: LiveCounts | None = None
    lastTip: LiveTip | None = None


class LiveSegmentFacts(BaseModel):
    """FE가 구간 끝에 만드는 사실(설계 3.2). 모르는 필드는 버린다."""

    model_config = ConfigDict(extra="ignore")
    contractVersion: Literal[1] = 1
    segment: SegmentRange
    input: Literal["stick", "keyboard"]
    counts: LiveCounts
    timing: LiveTiming = Field(default_factory=LiveTiming)
    pads: list[LivePad] = Field(default_factory=list, max_length=3)
    hands: LiveHands = Field(default_factory=LiveHands)
    ruleCoach: RuleCoach = Field(default_factory=RuleCoach)
    previous: PreviousSegment = Field(default_factory=PreviousSegment)
    stage: int = Field(ge=0, le=3)


SYSTEM_PROMPT = (
    "당신은 연주 중인 초보 드럼 연주자 옆에서 짧게 한마디 해 주는 드럼 코치입니다. "
    "방금 끝난 몇 마디의 '사실'만 보고, 다음 마디에서 바로 따라 할 수 있는 지시 하나를 씁니다.\n"
    "규칙:\n"
    f'1. JSON 하나만 출력하세요: {{"title": "...", "sub": "..."}}. title은 {MAX_TITLE}자 이하의 구령, '
    f"sub는 {MAX_SUB}자 이하로 방법이나 이유를 '~해요' 말투로.\n"
    "2. 몸의 어디를 어떻게 할지와 따라 할 기준(예: 주먹 하나 높이, 킥 소리, 마디 첫 박)을 말하세요. "
    "'잘해요', '놓쳤어요' 같은 상태 알림만 하지 마세요.\n"
    "3. 숫자를 쓰지 마세요. 점수·정확도를 말하지 말고, 비난하거나 단정하지 마세요.\n"
    "4. 패드는 사실에 나온 이름만 쓰세요(킥은 박의 기준으로 말해도 됩니다).\n"
    "5. 입력이 키보드면 스틱·손목·떨구기를 말하지 말고 손가락과 키 누르기로 말하세요. 키 이름(영어 글자)은 쓰지 마세요.\n"
    "6. 가장 큰 문제 하나만 말하고, 직전에 한 말과 같은 말은 하지 마세요. 문제가 없으면 지금처럼 하라고 짧게 칭찬하세요.\n"
    "7. 영어·이모지·마크다운을 쓰지 마세요."
)


def _pad_ko(pad: str) -> str:
    return LIVE_PAD_KO.get(pad, pad)


def _timing_ko(t: LiveTiming) -> str | None:
    if t.meanDeltaMs is None:
        return None
    if abs(t.meanDeltaMs) < 10:
        direction = "박에 거의 맞음"
    elif t.meanDeltaMs > 0:
        direction = "박보다 늦음"
    else:
        direction = "박보다 빠름"
    steady = (
        ""
        if t.stdDeltaMs is None
        else (", 박 간격이 들쭉날쭉함" if t.stdDeltaMs >= 30 else ", 박 간격은 고름")
    )
    return f"타이밍: {direction}{steady}"


def build_user_prompt(facts: LiveSegmentFacts, hint: str | None = None) -> str:
    """사실을 한국어 줄로 바꾼다. 숫자는 모델이 문장에 옮기지 않도록 말로 풀어 쓴다(안내 칸에는 숫자를 쓰지 않는다)."""
    c = facts.counts
    total = c.perfect + c.good + c.miss
    lines = [
        f"구간: {facts.segment.fromBar}~{facts.segment.toBar}마디",
        f"입력: {'키보드' if facts.input == 'keyboard' else '스틱'}",
        f"판정: 노트 {total}개 중 놓침 {'없음' if c.miss == 0 else ('조금' if c.miss * 5 < total else '많음')}",
    ]
    timing = _timing_ko(facts.timing)
    if timing:
        lines.append(timing)
    for p in facts.pads:
        side = ""
        if p.meanDeltaMs is not None and abs(p.meanDeltaMs) >= 15:
            side = ", 늦게 침" if p.meanDeltaMs > 0 else ", 빠르게 침"
        lines.append(
            f"눈에 띄는 패드: {_pad_ko(p.pad)}(놓침 {'있음' if p.misses else '없음'}{side})"
        )
    if facts.hands.weakHand and facts.input == "stick":
        lines.append(f"약한 손: {'왼손' if facts.hands.weakHand == 'LEFT' else '오른손'}")
    if facts.ruleCoach.tags:
        lines.append(
            "이 구간에 뜬 지적: " + ", ".join(TAG_KO.get(t, t) for t in facts.ruleCoach.tags)
        )
    if facts.ruleCoach.causes:
        lines.append(
            "놓친 이유 추정: " + ", ".join(CAUSE_KO.get(x, x) for x in facts.ruleCoach.causes)
        )
    prev = facts.previous
    if prev.counts is not None:
        pt = prev.counts.perfect + prev.counts.good + prev.counts.miss
        before = prev.counts.miss / pt if pt else 0.0
        now = c.miss / total if total else 0.0
        trend = "비슷함" if abs(now - before) < 0.05 else ("줄었음" if now < before else "늘었음")
        lines.append(f"직전 구간보다 놓침이 {trend}")
    if prev.lastTip is not None:
        lines.append(f'직전에 한 말(반복 금지): "{prev.lastTip.title} / {prev.lastTip.sub}"')
    if hint:
        lines.append(f"앞선 답의 문제(고쳐서 다시 쓰세요): {hint}")
    return "사실:\n" + "\n".join(f"- {line}" for line in lines)


def parse_tip(text: str) -> LiveTip | None:
    """모델 답에서 첫 JSON 객체를 읽는다. 코드 울타리나 앞뒤 말이 붙어도 된다. 없거나 모양이 틀리면 None"""
    m = _JSON.search(text)
    if not m:
        return None
    try:
        raw = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("title"), str):
        return None
    sub = raw.get("sub", "")
    if not isinstance(sub, str):
        return None
    return LiveTip(title=clean(raw["title"])[:40], sub=clean(sub)[:60])


def allowed_pad_names(facts: LiveSegmentFacts) -> set[str]:
    return {_pad_ko(p.pad) for p in facts.pads} | {_pad_ko(p) for p in ANCHOR_PADS}


def _mentioned_pads(text: str) -> set[str]:
    """문장에 나온 패드 이름. 긴 이름부터 지워 가며 찾아 '하이햇 페달'을 '하이햇'으로, '플로어탐'을 '탐'으로 잘못 세지 않는다"""
    found: set[str] = set()
    rest = text
    for name in sorted(LIVE_PAD_KO.values(), key=len, reverse=True):
        if name in rest:
            found.add(name)
            rest = rest.replace(name, " ")
    return found


def check(tip: LiveTip, facts: LiveSegmentFacts) -> list[str]:
    """어긴 규칙 목록. 비어 있으면 통과"""
    problems: list[str] = []
    both = f"{tip.title} {tip.sub}"
    if not tip.title.strip():
        problems.append("제목이 비었음")
    if len(tip.title) > MAX_TITLE:
        problems.append(f"제목이 {MAX_TITLE}자를 넘음")
    if len(tip.sub) > MAX_SUB:
        problems.append(f"보조가 {MAX_SUB}자를 넘음")
    if _DIGIT.search(both):
        problems.append("숫자를 씀")
    if any(w in both for w in FORBIDDEN_WORDS) or "정확도" in both:
        problems.append("금지어를 씀")
    if _FOREIGN.search(both):
        problems.append("영어·외국 글자를 씀")
    if _MARKUP.search(both):
        problems.append("마크다운·기호를 씀")
    if facts.input == "keyboard" and any(w in both for w in _STICK_WORDS):
        problems.append("키보드인데 스틱 표현을 씀")
    extra = _mentioned_pads(both) - allowed_pad_names(facts)
    if extra:
        problems.append("사실에 없는 패드를 말함: " + ", ".join(sorted(extra)))
    last = facts.previous.lastTip
    if last is not None and (tip.title == last.title or (tip.sub and tip.sub == last.sub)):
        problems.append("직전 문구를 반복함")
    return problems


@dataclass(frozen=True)
class LiveTipOutcome:
    """`tip`이 None이면 통과한 문구가 없다 → 그 구간은 규칙 코칭만 쓴다"""

    tip: LiveTip | None
    attempts: int
    violations: list[str] = field(default_factory=list)


def write_live_tip(
    facts: LiveSegmentFacts, generator: TextGenerator, max_attempts: int = 2
) -> LiveTipOutcome:
    """생성기를 최대 `max_attempts`번 불러 가드레일을 통과한 첫 문구를 돌려준다.

    연주 중이라 시간이 짧다. 두 번째 시도에는 첫 시도의 문제를 알려 준다. 생성기 예외는 다시 시도하지 않는다.
    """
    hint: str | None = None
    problems: list[str] = []
    attempts = 0
    for attempts in range(1, max_attempts + 1):
        try:
            raw = generator(SYSTEM_PROMPT, build_user_prompt(facts, hint))
        except Exception as exc:  # noqa: BLE001 - 어떤 생성기 오류도 규칙 코칭으로 되돌린다
            return LiveTipOutcome(None, attempts, [f"생성기 오류 {type(exc).__name__}"])
        tip = parse_tip(raw)
        problems = ["JSON 모양이 아님"] if tip is None else check(tip, facts)
        if tip is not None and not problems:
            return LiveTipOutcome(tip, attempts)
        hint = "; ".join(problems)
    return LiveTipOutcome(None, attempts, problems)
