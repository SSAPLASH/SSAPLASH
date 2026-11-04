"""LLM 총평 문장(`summary.source=LLM`)의 사실 → 프롬프트 → 가드레일 → 폴백 (설계 v0.6).

로컬 오픈소스 모델이 쓴 문장을 그대로 믿지 않는다. 사실(`NarrativeFacts`)에 없는 숫자·패드·비교를 만들거나,
점수·비난 표현, 다른 나라 글자가 섞이면 버리고 호출한 쪽이 규칙 총평을 그대로 쓰게 한다.

이 모듈은 모델을 모른다. `TextGenerator`(문자열 두 개를 받아 문자열을 돌려주는 함수)만 받으므로 시험에서는
가짜 생성기를 쓰고, 실제 모델은 GPU 워커가 같은 모양으로 끼운다. 타격 원본·회원 번호·`playId`는 사실에 없다.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ssaplash_ai.coach.config import MAX_NARRATIVE_CHARS, PAD_LABELS_KO
from ssaplash_ai.coach.schema import AnalysisResponse

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

# 점수·정확도는 BE가 따로 계산해 보여 주고, 비난·단정은 쓰지 않는다
FORBIDDEN_WORDS = (
    "점수",
    "정확도",
    "랭킹",
    "못해요",
    "못 쳐",
    "못 치",
    "틀렸",
    "최악",
    "형편없",
    "쓰레기",
    "재능",
    "실력이 없",
)
_PREVIOUS_WORDS = ("지난번", "저번", "이전", "예전", "전보다", "지난 연주", "지난 플레이")
_BETTER_WORDS = ("나아졌", "좋아졌", "줄었", "개선", "향상", "발전")
_WORSE_WORDS = ("나빠졌", "늘었", "악화", "떨어졌")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
# 모델이 답에 섞어 내보내는 전용 토큰과 생각 블록(EXAONE `[|endofturn|]`, Qwen `<|im_end|>`·`<think>`, Gemma `<end_of_turn>`)
_SPECIAL_TOKENS = re.compile(
    r"<think>.*?</think>|\[\|[^\]\n]{0,30}\|\]|<\|[^>\n]{0,30}\|>|</?think>|</?(?:start|end)_of_turn>",
    re.DOTALL,
)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
# 한글·숫자·기본 문장부호·공백·% 외의 글자(한자, 가나, 영어 단어, 이모지)가 섞였는지 본다
_FOREIGN = re.compile(r"[A-Za-z぀-ヿ㐀-鿿\U0001F000-\U0001FFFF☀-➿]")
_MARKUP = re.compile(r"[*#`>|\[\]{}_]|^\s*[-•·]\s", re.MULTILINE)


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


# ---------- 가드레일 ----------


def _variants(value: float) -> set[str]:
    """숫자 하나가 문장에 나올 수 있는 모양들: 정수, 소수 한·두 자리, 비율이면 백분율."""
    out = {str(round(value)), _trim(f"{value:.1f}"), _trim(f"{value:.2f}")}
    if 0 <= abs(value) <= 1:
        out.add(str(round(abs(value) * 100)))
    out.add(str(round(abs(value))))
    return out


def _trim(text: str) -> str:
    return text.rstrip("0").rstrip(".") if "." in text else text


def _allowed_numbers(facts: NarrativeFacts) -> set[str]:
    allowed: set[str] = set()

    def add(value: float) -> None:
        allowed.update(_variants(float(value)))

    c = facts.counts
    for v in (c.perfect, c.good, c.miss, c.total):
        add(v)
    add(_pct(c.miss_rate))
    add(_pct(c.perfect_share))
    for s in facts.segments:
        add(s.fromMs / 1000)
        add(s.toMs / 1000)
        add((s.toMs - s.fromMs) / 1000)
        numeric = {k: v for k, v in s.metrics.items() if isinstance(v, (int, float))}
        for v in numeric.values():
            add(v)
        # 패드가 다른 패드보다 얼마나 늦은지: 두 평균의 차이
        mean, overall = numeric.get("meanDeltaMs"), numeric.get("overallMeanDeltaMs")
        if mean is not None and overall is not None:
            add(abs(mean - overall))
    if facts.history:
        p = facts.history.previous.counts
        for v in (p.perfect, p.good, p.miss, p.total, facts.history.sameSongPlays):
            add(v)
        add(_pct(p.miss_rate))
        add(abs(_pct(c.miss_rate) - _pct(p.miss_rate)))  # 놓침 비율 변화(퍼센트포인트)
        add(abs(c.miss - p.miss))
    return allowed


def _trend(facts: NarrativeFacts) -> Literal["BETTER", "WORSE", "SAME", "NONE"]:
    if facts.history is None:
        return "NONE"
    diff = facts.counts.miss_rate - facts.history.previous.counts.miss_rate
    if diff <= -0.02:
        return "BETTER"
    if diff >= 0.02:
        return "WORSE"
    return "SAME"


def clean(text: str) -> str:
    """모델 출력에서 전용 토큰·생각 블록을 지우고 줄바꿈을 공백 하나로 합친다. 문장 내용은 바꾸지 않는다."""
    text = _SPECIAL_TOKENS.sub(" ", text)
    text = re.sub(r"\s*\n+\s*", " ", text)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def check(text: str, facts: NarrativeFacts) -> list[str]:
    """문장이 규칙을 어긴 곳의 목록. 비어 있으면 통과."""
    problems: list[str] = []
    body = text.strip()
    if not body:
        return ["빈 문장"]
    if len(body) > MAX_NARRATIVE_CHARS:
        problems.append(f"{MAX_NARRATIVE_CHARS}자를 넘음({len(body)}자)")
    if "\n" in body:
        problems.append("한 문단이 아님(줄바꿈)")
    if _MARKUP.search(body):
        problems.append("마크다운·목록 표시가 있음")
    if _FOREIGN.search(body):
        problems.append("한글이 아닌 글자(영어·한자·가나·이모지)가 섞임")
    if not re.search(r"[가-힣]", body) or not body.endswith(("요.", "요", "다.", "다")):
        problems.append("한국어 완성 문장이 아님")
    for word in FORBIDDEN_WORDS:
        if word in body:
            problems.append(f"금지 표현 '{word}'")

    allowed = _allowed_numbers(facts)
    strange = sorted({n for n in _NUMBER.findall(body) if n not in allowed})
    if strange:
        problems.append("사실에 없는 숫자 " + ", ".join(strange))

    known = {_pad_ko(p) for s in facts.segments for p in s.pads}
    if facts.strengthPad:
        known.add(_pad_ko(facts.strengthPad))
    for label in PAD_LABELS_KO.values():
        if label in body and label not in known:
            problems.append(f"사실에 없는 패드 '{label}'")

    trend = _trend(facts)
    # 비교는 "지난번·이전" 같은 말이 들어 있는 문장 안에서만 본다. "실력이 향상돼요"처럼 비교가 아닌 평범한 문장은 오탐이다
    for sentence in _SENTENCE_SPLIT.split(body):
        if not any(w in sentence for w in _PREVIOUS_WORDS):
            continue
        if trend == "NONE":
            problems.append("지난 연주 기록이 없는데 비교함")
            break
        if trend == "WORSE" and any(w in sentence for w in _BETTER_WORDS):
            problems.append("지난번보다 놓침이 늘었는데 나아졌다고 씀")
            break
        if trend == "BETTER" and any(w in sentence for w in _WORSE_WORDS):
            problems.append("지난번보다 놓침이 줄었는데 나빠졌다고 씀")
            break
    return problems


# ---------- 생성 ----------


@dataclass(frozen=True)
class NarrativeOutcome:
    """`text`가 None이면 가드레일을 통과한 문장이 없다 → 호출한 쪽이 규칙 총평을 그대로 쓴다."""

    text: str | None
    attempts: int
    violations: list[str] = field(default_factory=list)
    # 마지막 시도의 (정리한) 원문. 거절 이유를 눈으로 확인하는 용도라 운영 로그에는 남기지 않는다
    last_text: str | None = None


def write_narrative(
    facts: NarrativeFacts, generator: TextGenerator, max_attempts: int = 2
) -> NarrativeOutcome:
    """생성기를 최대 `max_attempts`번 불러 가드레일을 통과한 첫 문장을 돌려준다.

    두 번째 시도에는 첫 시도의 문제를 알려 준다. 생성기가 예외를 던지면 재시도하지 않고 실패로 돌려준다
    (모델 적재 실패 같은 환경 문제는 다시 해도 같다).
    """
    hint: str | None = None
    problems: list[str] = []
    attempts = 0
    last: str | None = None
    for attempts in range(1, max_attempts + 1):
        try:
            text = clean(generator(SYSTEM_PROMPT, build_user_prompt(facts, hint)))
        except Exception as exc:  # noqa: BLE001 - 어떤 생성기 오류도 규칙 총평으로 되돌린다
            return NarrativeOutcome(None, attempts, [f"생성기 오류 {type(exc).__name__}"])
        problems = check(text, facts)
        if not problems:
            return NarrativeOutcome(text, attempts, last_text=text)
        last = text
        hint = "; ".join(problems)
    return NarrativeOutcome(None, attempts, problems, last_text=last)


def facts_from_analysis(
    response: AnalysisResponse, counts: Counts, history: History | None = None
) -> NarrativeFacts | None:
    """약점 분석 응답(규칙 총평 포함)과 판정 개수로 사실을 만든다. 총평이 없으면(표본 부족) None.

    운영에서는 BE가 저장된 값으로 같은 모양을 만든다. 이 함수는 평가 스크립트와 통합 시험이 쓴다.
    """
    summary = response.summary
    if summary is None:
        return None
    segments = [
        FactSegment(
            pattern=s.pattern,
            severityLevel=s.severityLevel or "LOW",
            pads=s.pads,
            fromMs=s.fromMs,
            toMs=s.toMs,
            scope="SEGMENT" if s.metrics.get("scope") == "SEGMENT" else "WHOLE",
            metrics={k: v for k, v in s.metrics.items() if k != "scope"},
        )
        for s in response.weakSegments
    ]
    return NarrativeFacts(
        level=summary.level,
        focusPattern=summary.focusPattern,
        counts=counts,
        strengthPad=summary.strengthPad,
        segments=segments,
        history=history,
    )
