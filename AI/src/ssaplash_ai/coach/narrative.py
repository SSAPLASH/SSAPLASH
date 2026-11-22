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

from ssaplash_ai.coach.config import (
    MAX_NARRATIVE_CHARS,
    MAX_NARRATIVE_SENTENCE_CHARS,
    MAX_NARRATIVE_SENTENCES,
    MIN_NARRATIVE_SENTENCES,
    MIN_NARRATIVE_SENTENCES_NO_WEAKNESS,
    PAD_LABELS_KO,
)
from ssaplash_ai.coach.schema import AnalysisResponse

# 시스템 프롬프트와 사용자 프롬프트를 받아 문장을 돌려주는 함수. 실제 모델은 이 모양으로 끼운다.
TextGenerator = Callable[[str, str], str]

SEVERITY_KO = {"LOW": "조금", "MEDIUM": "보통", "HIGH": "많이"}
LEVEL_KO = {"GOOD": "좋음", "FAIR": "보통", "NEEDS_WORK": "더 연습이 필요함"}
METRIC_KO = {
    "meanDeltaMs": "평균 오차(ms, 양수는 늦음)",
    "overallMeanDeltaMs": "전체 평균 오차(ms)",
    "hitCount": "유효 타격 수",
    "missRate": "놓침 비율",
    "missCount": "놓친 개수",
    "noteCount": "노트 수",
    "transitionCount": "전환 횟수",
    "velocityRatio": "약한 손 세기 비율",
    "weakHitCount": "약한 손 타격 수",
    "strongHitCount": "센 손 타격 수",
    "stdDeltaMs": "오차 표준편차(ms)",
}
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
# 번역투·꾸미는 말·다짐·응원. 평가에서 나온 문장을 읽으면서 더하거나 뺀다
STIFF_WORDS = (
    "인상적",
    "모습",
    "풍성",
    "사운드",
    "밸런스",
    "믿어요",
    "분명히",
    "노력하면",
    "유지되",
    "살려내",
    "집중하며",
    "만들어낼 수",
    "수 있을 거예요",
    "해보시면",
    "해 보시면",
)
# "살려내셨고"·"치셨어요" 같은 높임. 총평은 "~해요" 말투다("보세요"는 걸리지 않는다)
_HONORIFIC = re.compile(r"[가-힣]셨")

_PREVIOUS_WORDS = ("지난번", "저번", "이전", "예전", "전보다", "지난 연주", "지난 플레이")
_BETTER_WORDS = ("나아", "나은", "좋아졌", "줄었", "줄어", "감소", "개선", "향상", "발전", "호전")
_WORSE_WORDS = ("나빠", "늘었", "늘어", "악화", "떨어", "증가", "퇴보")
# 칭찬하는 말. 약점으로 지목된 패드를 이런 말과 같은 문장에서 칭찬하면 사실과 어긋난다
_PRAISE_WORDS = (
    "훌륭",
    "좋았",
    "돋보",
    "인상적",
    "멋졌",
    "칭찬",
    "잘 쳤",
    "잘했",
    "안정적",
)
_EMOJI = re.compile("[\U0001f000-\U0001ffff☀-➿️‍]")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
# 탭·줄바꿈 등 제어 문자(DEL 포함). BE가 총평에서 거절하는 문자와 같은 범위
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
# 모델이 답에 섞어 내보내는 전용 토큰과 생각 블록(EXAONE `[|endofturn|]`, Qwen `<|im_end|>`·`<think>`, Gemma `<end_of_turn>`)
_SPECIAL_TOKENS = re.compile(
    r"<think>.*?</think>|\[\|[^\]\n]{0,30}\|\]|<\|[^>\n]{0,30}\|>|</?think>|</?(?:start|end)_of_turn>",
    re.DOTALL,
)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
# 종결 어미: 「요」·「죠」·「니다」. 「중요 포인트」·「필요 이상」처럼 명사가 「요」로 끝나는 자리는 뺀다
_ENDING = r"(?:(?<![중필주수개동소강민])요|죠|니다)"
# 종결 어미 뒤에 부호 없이 다음 문장이 이어진 자리, 부호 없이 끝난 자리
_RUN_ON = re.compile(_ENDING + r"(?=\s+[가-힣0-9])")
_OPEN_END = re.compile(_ENDING + r"$")
_ACCURACY_NUMBER = re.compile(r"정확도\D{0,6}\d")
_UNIT_MS = re.compile(r"(?<=\d)\s*ms(?![A-Za-z])")
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
    "쓸 내용(이 순서로, 해당하는 것만. 문장마다 한 가지씩):\n"
    "① 전체 인상 한마디. 첫 문장은 15자 안팎의 짧은 격려로 씁니다.\n"
    "② 잘한 점 하나. '잘한 패드'가 사실에 있으면 그 패드를, 없고 '비교 결과'가 있으면 그 비교를 말합니다. "
    "둘 다 없으면 건너뜁니다.\n"
    "③ '먼저 연습할 약점'이 있으면 그 약점이 어디서 어떻게 나타났는지 한 문장.\n"
    "④ 이어서 그 약점을 어떻게 연습할지 한 문장.\n"
    "'약점 없음'이면 ③④ 대신 눈에 띄는 약점이 없었다는 말만 씁니다.\n"
    "규칙:\n"
    f"1. 문장은 {MIN_NARRATIVE_SENTENCES}~{MAX_NARRATIVE_SENTENCES}개"
    f"(약점이 없으면 {MIN_NARRATIVE_SENTENCES_NO_WEAKNESS}~3개). "
    "한 문장에 한 가지만 말하고 쉼표로 여러 내용을 잇지 마세요. "
    f"한 문장은 {MAX_NARRATIVE_SENTENCE_CHARS}자 이하, 전체는 {MAX_NARRATIVE_CHARS}자 이하.\n"
    "2. 문장마다 마침표로 끝내고 '~해요' 말투로 쓰세요. '~하셨어요' 같은 높임말은 쓰지 마세요.\n"
    "3. 사실에 없는 숫자·패드·조언을 만들지 마세요. 약점이 없으면 연습을 권하지 마세요.\n"
    "4. 점수와 정확도는 말하지 마세요. 비난하거나 단정하지 마세요. 약점에 나온 패드는 칭찬하지 마세요.\n"
    "5. 친구 같은 코치가 말하듯 쉬운 말로 쓰세요. 꾸미는 말과 다짐·응원('믿어요', '노력하면'), "
    "'인상적'·'사운드'·'밸런스' 같은 말을 쓰지 마세요.\n"
    "6. 목록·마크다운·이모지·영어를 쓰지 마세요.\n"
    "좋은 예:\n"
    "- 기본기는 잘 잡혀 있어요. 박자가 전체적으로 조금씩 늦어요. 박을 끝까지 듣고 쳐 보세요.\n"
    "- 정말 잘 쳤어요. 박자와 판정이 안정적이에요. 눈에 띄는 약점은 없었어요.\n"
    "- 지난번보다 놓침이 줄었어요. 중간 구간에서 놓친 노트가 몰려 있어요. 그 구간만 느리게 다시 쳐 보세요.\n"
    "총평 문장만 출력하세요."
)


def _pad_ko(pad: str) -> str:
    return PAD_LABELS_KO.get(pad, pad)


def _pct(rate: float) -> int:
    return round(rate * 100)


def _focus_segments(facts: NarrativeFacts) -> list[FactSegment]:
    """프롬프트에 넣을 약점: `focusPattern`과 같은 첫 항목, 없으면 맨 앞 항목 하나."""
    for s in facts.segments:
        if s.pattern == facts.focusPattern:
            return [s]
    return list(facts.segments[:1])


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
        lines.append("- 약점 없음: 눈에 띄는 약점이 없었음(연습을 권하지 마세요)")
    # 약점을 여러 개 주면 모델이 다 말하려다 길어진다. 가장 먼저 연습할 것 하나만 준다(나머지는 리포트의 약점 카드가 보인다)
    for s in _focus_segments(facts):
        where = (
            "곡 전체"
            if s.scope == "WHOLE"
            else f"{round(s.fromMs / 1000)}~{round(s.toMs / 1000)}초 구간"
        )
        pads = ", ".join(_pad_ko(p) for p in s.pads) or "패드 지정 없음"
        # 영어 항목 이름(meanDeltaMs 등)이 문장에 그대로 나오지 않게 한국어 이름으로 보여 준다. 모르는 항목은 뺀다
        nums = ", ".join(f"{METRIC_KO[k]} {v}" for k, v in s.metrics.items() if k in METRIC_KO)
        label = PATTERN_KO.get(s.pattern, s.pattern)
        lines.append(
            f"- 먼저 연습할 약점: {label} / 심각도 {SEVERITY_KO[s.severityLevel]} / {where} "
            f"/ 패드 {pads} / {nums}"
        )
    # 놓침이 달라지지 않았으면 비교할 것이 없다("비슷하게 유지됐어요" 같은 문장만 늘어난다)
    if facts.history and _trend(facts) in ("BETTER", "WORSE"):
        p = facts.history.previous.counts
        lines.append(
            f"- 지난 연주(같은 곡 이전 {facts.history.sameSongPlays}번 중 바로 직전): "
            f"완벽 {p.perfect}개, 좋음 {p.good}개, 놓침 {p.miss}개 (놓침 {_pct(p.miss_rate)}%)"
        )
        # 모델이 지난 연주의 약점이 나아졌는지를 짐작해 쓰지 않게, 비교는 놓침 비율 하나로 정해서 준다
        trend = {"BETTER": "줄었음(좋아짐)", "WORSE": "늘었음(나빠짐)"}[_trend(facts)]
        lines.append(
            f"- 비교 결과(비교는 이것만 말하세요): 놓침 비율이 지난번 {_pct(p.miss_rate)}%에서 "
            f"이번 {_pct(c.miss_rate)}%로 {trend}"
        )
    if hint:
        lines.append(
            f"\n이전 시도의 문제(이 내용을 문장에서 말하지 말고 고치기만 하세요): {hint}\n문제를 고쳐서 총평만 다시 쓰세요."
        )
    return "\n".join(lines)


# ---------- 가드레일 ----------


def _variants(value: float) -> set[str]:
    """숫자 하나가 문장에 나올 수 있는 모양들: 정수, 소수 한·두 자리, 비율이면 백분율.

    문장에서 숫자는 부호 없이 뽑으므로(`_NUMBER`) 음수도 절댓값 모양으로 만든다. 평균 오차 -35.4ms를 모델이
    "35.4ms 빠르게"라고 맞게 써도 통과해야 한다.
    """
    value = abs(value)
    out = {str(round(value)), _trim(f"{value:.1f}"), _trim(f"{value:.2f}")}
    if value <= 1:
        out.add(str(round(value * 100)))
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
        # 프롬프트에 실제로 보여 주는 지표만 허용한다. severity(0~1)처럼 보이지 않는 값을 허용하면 "55번" 같은 숫자가 통과한다
        numeric = {
            k: v for k, v in s.metrics.items() if k in METRIC_KO and isinstance(v, (int, float))
        }
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
    # 이모지는 문장 뜻을 바꾸지 않으니 지운다(작은 모델이 규칙을 어기고 자주 붙인다)
    text = _EMOJI.sub("", text)
    # **굵게**·`코드` 같은 강조 표시는 문장 뜻을 바꾸지 않으니 표시만 지운다(문장 전체를 버리지 않는다)
    text = re.sub(r"[*`]+", "", text)
    # 줄바꿈·탭 같은 제어 문자는 하나도 남기지 않는다(BE는 제어 문자가 있는 총평을 400으로 거절한다). 탭 한 개도 포함
    text = _CONTROL.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def punctuate(text: str) -> str:
    """종결 어미 뒤에 빠진 마침표를 붙인다. 글자는 바꾸지 않고 문장을 더하거나 빼지 않는다.

    화면은 「. ! ?」 뒤 공백에서 첫 문장과 나머지를 나눈다. 부호가 빠지면 총평 전체가 제목으로 간다.
    """
    text = _RUN_ON.sub(lambda m: m.group(0) + ".", text.strip())
    return text + "." if _OPEN_END.search(text) else text


def _min_sentences(facts: NarrativeFacts) -> int:
    """약점이 있으면 인상·무슨 일·연습 방법까지 3문장, 없으면 2문장이면 된다."""
    return MIN_NARRATIVE_SENTENCES if facts.segments else MIN_NARRATIVE_SENTENCES_NO_WEAKNESS


def check(text: str, facts: NarrativeFacts) -> list[str]:
    """문장이 규칙을 어긴 곳의 목록. 비어 있으면 통과."""
    problems: list[str] = []
    body = text.strip()
    if not body:
        return ["빈 문장"]
    if len(body) > MAX_NARRATIVE_CHARS:
        problems.append(f"{MAX_NARRATIVE_CHARS}자를 넘음({len(body)}자)")
    if _CONTROL.search(body):
        problems.append("제어 문자(탭·줄바꿈 등)가 있음")
    if "\n" in body:
        problems.append("한 문단이 아님(줄바꿈)")
    if _MARKUP.search(body):
        problems.append("마크다운·목록 표시가 있음")
    # 숫자 뒤의 단위 ms는 정당한 표기라 영어 글자로 치지 않는다
    if _FOREIGN.search(_UNIT_MS.sub("", body)):
        problems.append("한글이 아닌 글자(영어·한자·가나·이모지)가 섞임")
    if not re.search(r"[가-힣]", body) or not body.endswith(
        ("요.", "요!", "요?", "죠.", "죠!", "죠?", "다.", "다!", "다?")
    ):
        problems.append("한국어 완성 문장이 아님")
    # 화면이 첫 문장(제목)과 나머지(설명)를 부호로 나눈다. 부호 없이 이어 쓰거나 한 문장뿐이면 설명이 빈다
    if _RUN_ON.search(body):
        problems.append("문장이 부호 없이 이어짐")
    sentences = [s for s in _SENTENCE_SPLIT.split(body) if s]
    minimum = _min_sentences(facts)
    if len(sentences) < minimum:
        problems.append(f"문장이 {minimum}개 미만")
    if len(sentences) > MAX_NARRATIVE_SENTENCES:
        problems.append(f"문장이 {MAX_NARRATIVE_SENTENCES}개를 넘음")
    longest = max(len(s) for s in sentences)
    if longest > MAX_NARRATIVE_SENTENCE_CHARS:
        problems.append(f"문장이 김({longest}자)")
    # 번역투·꾸미는 말·다짐. 프롬프트의 예시로 먼저 줄이고, 자주 나오는 것만 여기서 막는다
    for word in STIFF_WORDS:
        if word in body:
            problems.append(f"어색한 표현 '{word}'")
    if _HONORIFIC.search(body):
        problems.append("어색한 표현 '높임말'")
    for word in FORBIDDEN_WORDS:
        if word in body:
            problems.append(f"금지 표현 '{word}'")
    # 정확도는 BE가 계산해 보여 주는 값이라 숫자와 함께 말하면 어긋날 수 있다. 숫자 없는 평범한 쓰임은 괜찮다
    if _ACCURACY_NUMBER.search(body):
        problems.append("금지 표현 '정확도' 수치")

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

    # 약점으로 지목된 패드를 칭찬하는 문장("스네어 연주가 좋았어요")은 사실과 어긋난다. 잘한 패드로 꼽힌 것은 제외
    weak_labels = {_pad_ko(p) for s in facts.segments for p in s.pads}
    if facts.strengthPad:
        weak_labels.discard(_pad_ko(facts.strengthPad))
    for sentence in _SENTENCE_SPLIT.split(body):
        if any(w in sentence for w in _PRAISE_WORDS):
            praised = sorted(label for label in weak_labels if label in sentence)
            if praised:
                problems.append(f"약점 패드를 칭찬함 '{praised[0]}'")
                break

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


# ---------- 보정 ----------

_WHOLE_TEXT_PROBLEMS = (
    "한국어 완성 문장",
    f"문장이 {MIN_NARRATIVE_SENTENCES_NO_WEAKNESS}개 미만",
    f"문장이 {MIN_NARRATIVE_SENTENCES}개 미만",
    f"문장이 {MAX_NARRATIVE_SENTENCES}개를 넘음",
)


def repair(text: str, facts: NarrativeFacts) -> str | None:
    """규칙을 어긴 **문장만 덜어내고** 나머지로 총평을 만든다. 덜어낼 게 없거나 덜어낸 뒤에도 쓸 수 없으면 None.

    문장 전체를 버리면 한 문장의 위반 때문에 멀쩡한 문장까지 사라진다. 덜어내는 것은 거짓 주장을 지우는 쪽이라
    안전하다. 연습 안내 문장이 하나도 남지 않거나 문장이 2개 미만이면 쓰지 않는다.
    """
    sentences = [s for s in _SENTENCE_SPLIT.split(text.strip()) if s]
    # 문장 하나를 따로 볼 때 "완성 문장이 아님"·"2개 미만"은 전체 모양을 보는 조건이라 문장 단위 판정에서 뺀다
    kept = [
        s
        for s in sentences
        if not [p for p in check(s, facts) if not p.startswith(_WHOLE_TEXT_PROBLEMS)]
    ]
    # 문장이 많거나 전체가 길면 뒤에서부터 덜어낸다(앞쪽이 전체 인상과 잘한 점이다)
    minimum = _min_sentences(facts)
    kept = kept[:MAX_NARRATIVE_SENTENCES]
    while len(kept) > minimum and len(" ".join(kept)) > MAX_NARRATIVE_CHARS:
        kept = kept[:-1]
    if len(kept) == len(sentences) or len(kept) < minimum:
        return None
    repaired = " ".join(kept)
    # 약점이 있는데 연습 안내 문장이 하나도 남지 않으면 쓰지 않는다. 약점이 없으면 안내가 없는 것이 맞다
    if facts.segments and not re.search(r"연습|반복|해 보|쳐 보", repaired):
        return None
    if check(repaired, facts):
        return None
    return repaired


# ---------- 생성 ----------


@dataclass(frozen=True)
class NarrativeOutcome:
    """`text`가 None이면 가드레일을 통과한 문장이 없다 → 호출한 쪽이 규칙 총평을 그대로 쓴다."""

    text: str | None
    attempts: int
    violations: list[str] = field(default_factory=list)
    # 마지막 시도의 (정리한) 원문. 거절 이유를 눈으로 확인하는 용도라 운영 로그에는 남기지 않는다
    last_text: str | None = None
    # 규칙을 어긴 문장을 덜어내고 통과한 경우
    repaired: bool = False
    # 빠진 마침표를 붙인 경우(통과 여부와 무관)
    punctuated: bool = False


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
    punctuated = False
    for attempts in range(1, max_attempts + 1):
        try:
            raw = clean(generator(SYSTEM_PROMPT, build_user_prompt(facts, hint)))
        except Exception as exc:  # noqa: BLE001 - 어떤 생성기 오류도 규칙 총평으로 되돌린다
            return NarrativeOutcome(None, attempts, [f"생성기 오류 {type(exc).__name__}"])
        text = punctuate(raw)
        punctuated = punctuated or text != raw
        problems = check(text, facts)
        if not problems:
            return NarrativeOutcome(text, attempts, last_text=text, punctuated=punctuated)
        fixed = repair(text, facts)
        if fixed is not None:
            return NarrativeOutcome(
                fixed, attempts, problems, last_text=text, repaired=True, punctuated=punctuated
            )
        last = text
        hint = "; ".join(problems)
    return NarrativeOutcome(None, attempts, problems, last_text=last, punctuated=punctuated)


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
