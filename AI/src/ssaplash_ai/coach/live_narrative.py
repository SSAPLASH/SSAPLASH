"""연주 중 LLM 구간 코칭: 구간 사실 → 프롬프트 → 가드레일 (설계 COACH-001 연주 중 LLM 코칭 3.2, 3.5).

4·8·16마디 구간이 끝날 때 FE가 만든 구간 사실(`LiveSegmentFacts`)로 안내 칸 한 장(제목 8자, 보조 16자)을 쓴다.
모델은 리포트 총평과 같은 로컬 모델이고, 이 모듈은 모델을 모른다(`TextGenerator`만 받는다).
가드레일은 리포트 총평(`narrative.py`)의 금지어·특수 토큰·외국 글자 검사를 함께 쓰고, 안내 칸 원칙(숫자 없음,
짧은 길이, 키보드면 스틱 표현 없음, 스틱이면 누른다는 말 없음, 사실에 없는 패드 없음, 직전 문구 반복 없음,
근거 없는 자세 지시 없음, 사실과 반대 방향 지시 없음)을 더한다(설계 COACH-001 각도·실측평가 3.3).
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

# 화면 키트와 같은 패드 이름(FE `domain/pads.ts`의 PAD_META.label, `padName.ts`의 coachPadName). 리포트와 같다
LIVE_PAD_KO = {
    "CRASH": "크래시",
    "HIHAT": "하이햇",
    "SNARE": "스네어",
    "SMALL_TOM": "스몰탐",
    "MID_TOM": "미드탐",
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
# 스틱은 패드를 '친다'. 키를 누르는 말은 키보드에만 쓴다
_PRESS_WORDS = ("누르", "눌러")
# 자세 지시. 사실에 스틱 끝 방향(aim)이나 약한 손 근거가 없으면 모델이 지어낸 것이라 거절한다
_POSTURE_WORDS = (
    "손목",
    "팔꿈치",
    "팔을",
    "팔로",
    "팔 힘",
    "어깨",
    "젖혀",
    "꺾",
    "비틀",
    "기울",
    "스틱 끝",
)
# 타이밍과 반대로 말하는 표현: 늦은데 더 늦추라거나, 빠른데 더 서두르라는 말
_SLOWER_WORDS = ("천천히", "늦춰", "늦게 쳐", "늦게 눌", "여유 있게")
_FASTER_WORDS = ("서둘러", "빨리", "빠르게 쳐", "빠르게 눌", "당겨")
# 스틱 끝 방향과 반대로 말하는 표현. 낮게 친 사람에게 더 낮추라고 하면 거절한다
_LOWER_WORDS = ("낮게", "내려")
_HIGHER_WORDS = ("높게", "올려")
# 타이밍 방향을 정하는 평균 오차(ms). 사용자 프롬프트의 '박보다 늦음·빠름'과 같은 기준
TIMING_DIRECTION_MS = 10
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


class LiveAim(BaseModel):
    """스틱 끝 방향 치우침(설계 COACH-001 각도·실측평가 3.1). 각도 숫자 대신 방향·정도만 받는다"""

    model_config = ConfigDict(extra="ignore")
    pad: str
    hits: int = Field(ge=0)
    wrongPad: int = Field(default=0, ge=0)
    vertical: Literal["HIGH", "LOW"] | None = None
    horizontal: Literal["LEFT", "RIGHT"] | None = None
    size: Literal["SLIGHT", "CLEAR"] = "SLIGHT"
    hand: Literal["LEFT", "RIGHT"] | None = None


class LiveSegmentFacts(BaseModel):
    """FE가 구간 끝에 만드는 사실(설계 3.2). 모르는 필드는 버린다. `aim`은 선택 필드(없으면 빈 목록)"""

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
    aim: list[LiveAim] = Field(default_factory=list, max_length=3)


# 프롬프트에 넣는 예시: (상황, 제목, 보조). 모두 가드레일을 통과하는 길이·표현이다(시험에서 확인).
# 4b 모델은 "16자 이하"라는 숫자보다 예시 길이를 따라 쓴다
TIP_EXAMPLES: tuple[tuple[str, str, str], ...] = (
    ("박보다 늦음", "앞당겨요", "박보다 살짝 일찍 쳐요"),
    ("박보다 빠름", "기다려요", "킥 소리를 듣고 쳐요"),
    ("박 간격이 들쭉날쭉함", "고르게", "마디 첫 박을 세며 쳐요"),
    ("패드를 옮기다 놓침", "미리 보기", "옮길 패드를 먼저 봐요"),
    ("스틱 끝 방향: 스몰탐 칠 때 기준보다 낮음", "끝 들기", "스몰탐은 스틱 끝을 높게"),
    ("약한 손: 왼손", "왼손 또렷이", "왼손도 오른손만큼 쳐요"),
    ("키보드, 박보다 늦음", "일찍 눌러요", "박 직전에 키를 눌러요"),
    ("잘 친 구간", "그대로!", "지금 느낌 그대로요"),
)

SYSTEM_PROMPT = (
    "당신은 센서 스틱이나 키보드로 드럼을 치는 초보 연주자 옆에서 짧게 한마디 해 주는 드럼 코치입니다. "
    "방금 끝난 몇 마디의 '사실'만 보고, 다음 마디에서 바로 따라 할 지시 하나를 씁니다.\n"
    "규칙:\n"
    '1. JSON 하나만 출력하세요: {"title": "...", "sub": "..."}.\n'
    f"2. title은 공백 포함 {MAX_TITLE}자 이하의 구령, sub는 공백 포함 {MAX_SUB}자 이하의 한 구절입니다. "
    "sub는 아래 예시만큼 짧게, 열두 자 안팎으로 쓰고 문장을 두 개 쓰지 마세요.\n"
    "3. 사실에 '스틱 끝 방향'이나 '약한 손'이 있을 때만 손목·팔·스틱 끝 같은 자세를 말하세요. "
    "없으면 박과 소리(킥 소리, 마디 첫 박)를 기준으로 말하세요.\n"
    "4. 늦으면 일찍, 빠르면 기다렸다 치라고 하세요. 스틱 끝이 낮으면 높게, 높으면 낮게, "
    "왼쪽이면 오른쪽, 오른쪽이면 왼쪽으로 말하세요.\n"
    "5. 숫자를 쓰지 마세요. 점수·정확도를 말하지 말고, 비난하거나 단정하지 마세요.\n"
    "6. 패드는 사실에 나온 이름만 쓰세요(킥은 박의 기준으로 말해도 됩니다).\n"
    "7. 스틱이면 '쳐요'로 말하고 '누르다'를 쓰지 마세요. 키보드면 손가락과 키 누르기로 말하고 "
    "스틱·손목을 말하지 마세요. 키 이름(영어 글자)은 쓰지 마세요.\n"
    "8. 가장 큰 문제 하나만 말하세요. 직전에 한 말과 같은 말을 하지 말고, 제목을 상황에 맞게 바꾸세요. "
    "문제가 없으면 지금처럼 하라고 짧게 칭찬하세요.\n"
    "9. 영어·이모지·마크다운을 쓰지 마세요.\n"
    "예시(상황 → 답, 이 길이를 넘기지 마세요):\n"
    + "\n".join(
        f'- {situation} → {{"title": "{title}", "sub": "{sub}"}}'
        for situation, title, sub in TIP_EXAMPLES
    )
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


def _aim_ko(a: LiveAim) -> str:
    """스틱 끝 방향 한 줄. 예: '스틱 끝 방향: 스몰탐 칠 때 기준보다 낮고 왼쪽(조금 벗어남), 다른 패드로 잡힌 타격 있음'"""
    sides = [
        {"HIGH": "높고", "LOW": "낮고"}[a.vertical] if a.vertical else None,
        {"LEFT": "왼쪽", "RIGHT": "오른쪽"}[a.horizontal] if a.horizontal else None,
    ]
    where = " ".join(s for s in sides if s).removesuffix("고")
    if where.endswith(("높", "낮")):
        where += "음"
    size = "많이 벗어남" if a.size == "CLEAR" else "조금 벗어남"
    extra = ", 다른 패드로 잡힌 타격 있음" if a.wrongPad else ""
    hand = f", 주로 {'왼손' if a.hand == 'LEFT' else '오른손'}" if a.hand else ""
    return f"스틱 끝 방향: {_pad_ko(a.pad)} 칠 때 기준보다 {where}({size}){extra}{hand}"


def timing_direction(facts: LiveSegmentFacts) -> Literal["LATE", "EARLY"] | None:
    m = facts.timing.meanDeltaMs
    if m is None or abs(m) < TIMING_DIRECTION_MS:
        return None
    return "LATE" if m > 0 else "EARLY"


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
    if facts.input == "stick":
        lines.extend(_aim_ko(a) for a in facts.aim if a.vertical or a.horizontal)
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
    return (
        {_pad_ko(p.pad) for p in facts.pads}
        | {_pad_ko(a.pad) for a in facts.aim}
        | {_pad_ko(p) for p in ANCHOR_PADS}
    )


def _has_posture_evidence(facts: LiveSegmentFacts) -> bool:
    return facts.input == "stick" and (bool(facts.aim) or facts.hands.weakHand is not None)


def _contradictions(text: str, facts: LiveSegmentFacts) -> list[str]:
    """사실과 반대 방향으로 말한 것. 여러 aim이 서로 반대 방향이면 그 축은 보지 않는다"""
    out: list[str] = []
    direction = timing_direction(facts)
    if direction == "LATE" and any(w in text for w in _SLOWER_WORDS):
        out.append("늦은 구간에 더 늦추라고 함")
    if direction == "EARLY" and any(w in text for w in _FASTER_WORDS):
        out.append("빠른 구간에 더 서두르라고 함")
    aims = facts.aim if facts.input == "stick" else []
    vertical = {a.vertical for a in aims if a.vertical}
    horizontal = {a.horizontal for a in aims if a.horizontal}
    if vertical == {"LOW"} and any(w in text for w in _LOWER_WORDS):
        out.append("스틱 끝이 낮은데 더 낮추라고 함")
    if vertical == {"HIGH"} and any(w in text for w in _HIGHER_WORDS):
        out.append("스틱 끝이 높은데 더 높이라고 함")
    if horizontal == {"LEFT"} and "왼쪽" in text:
        out.append("스틱 끝이 왼쪽인데 더 왼쪽으로 하라고 함")
    if horizontal == {"RIGHT"} and "오른쪽" in text:
        out.append("스틱 끝이 오른쪽인데 더 오른쪽으로 하라고 함")
    return out


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
    """어긴 규칙 목록. 비어 있으면 통과.

    각 항목은 '규칙 이름' 또는 '규칙 이름: 자세히'다. 평가 집계는 ':' 앞만 센다. 자세히에는 사실 값을 넣지 않는다.
    """
    problems: list[str] = []
    both = f"{tip.title} {tip.sub}"
    if not tip.title.strip():
        problems.append("제목이 비었음")
    if len(tip.title) > MAX_TITLE:
        problems.append(
            f"제목이 {MAX_TITLE}자를 넘음: 지금 {len(tip.title)}자, {MAX_TITLE}자 이하로 줄이세요"
        )
    if len(tip.sub) > MAX_SUB:
        problems.append(
            f"보조가 {MAX_SUB}자를 넘음: 지금 공백 포함 {len(tip.sub)}자, {MAX_SUB}자 이하로 줄이세요"
        )
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
    if facts.input == "stick" and any(w in both for w in _PRESS_WORDS):
        problems.append("스틱인데 누른다고 함")
    if not _has_posture_evidence(facts) and any(w in both for w in _POSTURE_WORDS):
        problems.append("근거 없이 자세를 말함")
    problems.extend(_contradictions(both, facts))
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
    # 통과하지 못했을 때 마지막으로 거절된 문구(평가 보고서용). 통과했거나 JSON이 아니면 None
    rejected: LiveTip | None = None


def write_live_tip(
    facts: LiveSegmentFacts, generator: TextGenerator, max_attempts: int = 2
) -> LiveTipOutcome:
    """생성기를 최대 `max_attempts`번 불러 가드레일을 통과한 첫 문구를 돌려준다.

    연주 중이라 시간이 짧다. 두 번째 시도에는 첫 시도의 문제를 알려 준다. 생성기 예외는 다시 시도하지 않는다.
    """
    hint: str | None = None
    problems: list[str] = []
    attempts = 0
    tip: LiveTip | None = None
    for attempts in range(1, max_attempts + 1):
        try:
            raw = generator(SYSTEM_PROMPT, build_user_prompt(facts, hint))
        except Exception as exc:  # noqa: BLE001 - 어떤 생성기 오류도 규칙 코칭으로 되돌린다
            return LiveTipOutcome(None, attempts, [f"생성기 오류 {type(exc).__name__}"])
        tip = parse_tip(raw)
        problems = ["JSON 모양이 아님"] if tip is None else check(tip, facts)
        if tip is not None and not problems:
            return LiveTipOutcome(tip, attempts)
        hint = retry_hint(problems, tip)
    return LiveTipOutcome(None, attempts, problems, rejected=tip)


def retry_hint(problems: list[str], tip: LiveTip | None) -> str:
    """두 번째 시도에 줄 힌트. 무엇을 어겼는지와 앞선 답을 그대로 보여 줘야 4b 모델이 고친다"""
    text = "; ".join(problems)
    if tip is not None:
        text += f'. 앞선 답: {{"title": "{tip.title}", "sub": "{tip.sub}"}}'
    return text
