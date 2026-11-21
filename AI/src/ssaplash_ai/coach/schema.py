"""요청·응답 스키마 (BE와 합의한 형식, `.claude/mail` COACH-003 인터페이스 문서 회신 1~5).

입력 검증은 여기서 끝낸다. 검증 오류 응답에는 오류가 난 **필드 이름만** 담고 입력 값은 담지 않는다
(타격 데이터가 로그나 응답에 노출되지 않게 한다).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ssaplash_ai.coach.config import MAX_HITS

# 패드 이름. 정식 이름은 FE `PadId`·BE `Pad` 열거형과 같다.
KNOWN_PADS = (
    "HIHAT",
    "SNARE",
    "SMALL_TOM",
    "MID_TOM",
    "FLOOR_TOM",
    "CRASH",
    "RIDE",
    "KICK",
    "HIHAT_PEDAL",
)
# 옛 이름 → 정식 이름 (BE 호환 예외). 응답의 pads[]도 정식 이름을 쓴다.
LEGACY_PAD_ALIASES = {"HI_TOM": "SMALL_TOM"}
OTHER_PAD = "OTHER"

Judgement = Literal["PERFECT", "GOOD", "MISS"]
Reason = Literal["OK", "INSUFFICIENT_HITS", "NO_WEAKNESS"]
SeverityLevel = Literal["LOW", "MEDIUM", "HIGH"]
SummaryLevel = Literal["GOOD", "FAIR", "NEEDS_WORK"]


def normalize_pad(value: str) -> str:
    """옛 이름은 정식 이름으로, 모르는 이름은 `OTHER`로 바꾼다."""
    name = LEGACY_PAD_ALIASES.get(value, value)
    return name if name in KNOWN_PADS else OTHER_PAD


class TimingWindows(BaseModel):
    model_config = ConfigDict(extra="ignore")

    perfectMs: float = Field(ge=0)
    goodMs: float = Field(gt=0)


class Hit(BaseModel):
    """타격 한 줄. 모르는 필드(`pitch`, `yaw` 등)는 무시한다."""

    model_config = ConfigDict(extra="ignore")

    seq: int
    tMs: float
    stickId: int | None = None
    pad: str
    baselinePad: str | None = None
    predictedPad: str | None = None
    velocity: float | None = None
    peakAccel: float | None = None
    judgement: Judgement | None = None
    matchedNoteId: str | None = None
    deltaMs: float | None = None

    @field_validator("pad")
    @classmethod
    def _normalize_pad(cls, value: str) -> str:
        return normalize_pad(value)

    @model_validator(mode="after")
    def _judged_hit_has_delta(self) -> Hit:
        # PERFECT/GOOD는 노트에 맞은 타격이라 오차가 있어야 한다. 없으면 계약 위반이다.
        if self.judgement in ("PERFECT", "GOOD") and self.deltaMs is None:
            raise ValueError("deltaMs")
        return self


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    playId: str
    songId: int | None = None
    chartVersionId: int | None = None
    difficulty: str | None = None
    mode: Literal["RHYTHM", "SHEET"]
    timingWindows: TimingWindows
    # 연습 배율(느리게 치면 1 미만). `tMs`는 곡 시각, `deltaMs`·판정 폭은 실제 시간이다
    playbackRate: float = Field(default=1.0, gt=0, le=4)
    hits: list[Hit] = Field(max_length=MAX_HITS)


class WeakSegment(BaseModel):
    fromMs: float
    toMs: float
    pattern: str
    description: str
    # 연습 방법 한두 문장. 문구가 없는 pattern이면 None이고 응답에서 키를 생략한다
    tip: str | None = None
    # 이 약점이 무슨 뜻이고 얼마나 넓게 나타나는지 한두 문장. 문구가 없는 pattern이면 None
    detail: str | None = None
    # metrics.severity(0~1)를 단계로 옮긴 값
    severityLevel: SeverityLevel | None = None
    causeTags: list[str]
    pads: list[str]
    metrics: dict[str, float | int | str]


class Summary(BaseModel):
    """리포트 종합 총평. `text`는 코치가 직접 이야기해 주는 느낌의 규칙 문장이다."""

    level: SummaryLevel
    text: str
    # 가장 심한 약점의 pattern. 약점이 없으면 None (연습·곡 추천이 생기면 이 값으로 잇는다)
    focusPattern: str | None = None
    # 잘한 점으로 꼽은 패드(정식 이름). 없으면 None. LLM 총평 작업의 사실로 쓰인다
    strengthPad: str | None = None
    # RULE = 규칙 템플릿. 나중에 LLM 문장이 오면 LLM
    source: Literal["RULE", "LLM"] = "RULE"


class AnalysisResponse(BaseModel):
    analyzerVersion: str
    reason: Reason
    weakSegments: list[WeakSegment]
    # 노트가 하나도 없으면 None(응답에서 키를 생략한다). INSUFFICIENT_HITS여도 노트가 있으면 간단 총평이 온다
    summary: Summary | None = None
