"""이상치 제외: "진짜 플레이가 아닌 것"만 뺀다.

점수가 낮거나 많이 놓친 플레이는 빼지 않는다. 서툰 사용자의 기록을 지우면 코칭이 필요한 사람이 표본에서 사라져
임계값이 실제보다 낙관적으로 쏠리기 때문이다. 자리 비움 수준(놓침 90% 이상)만 뺀다.
키보드 입력은 시험용이라 빼지 않고 드럼과 **따로** 모은다(섞으면 오차·세기 분포가 흐려진다).

결과에는 이유별 건수만 담고 세션 키나 값은 담지 않는다.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from pydantic import ValidationError

from ssaplash_ai.coach.config import MAX_HITS, MIN_NOTES
from ssaplash_ai.coach.schema import AnalysisRequest
from ssaplash_ai.coach_calibration.source import Session

# 제외 이유. 기록과 MLflow 지표 이름에 그대로 쓰므로 바꾸면 이전 기록과 비교가 끊긴다.
CORRUPT = "CORRUPT"
UNSUPPORTED_MODE = "UNSUPPORTED_MODE"
TOO_LARGE = "TOO_LARGE"
TOO_FEW_NOTES = "TOO_FEW_NOTES"
IDLE = "IDLE"
EXCLUDE_REASONS = (CORRUPT, UNSUPPORTED_MODE, TOO_LARGE, TOO_FEW_NOTES, IDLE)

SUPPORTED_MODES = frozenset({"RHYTHM", "SHEET"})
INPUT_STICK = "STICK"
INPUT_KEYBOARD = "KEYBOARD"
NOTE_JUDGEMENTS = frozenset({"PERFECT", "GOOD", "MISS"})

FILTER_VERSION = "filters-1"


@dataclass(frozen=True)
class FilterConfig:
    idle_miss_rate: float = 0.9  # 노트 중 이 비율 이상 놓치면 자리를 비운 것으로 본다
    min_notes: int = MIN_NOTES  # 분석 엔진이 분석하지 않는 기준과 같다
    max_hits: int = MAX_HITS


DEFAULT_CONFIG = FilterConfig()


@dataclass
class FilterResult:
    drum: list[Session] = field(default_factory=list)
    keyboard: list[Session] = field(default_factory=list)
    excluded: Counter[str] = field(default_factory=Counter)
    total: int = 0

    @property
    def kept(self) -> int:
        return len(self.drum) + len(self.keyboard)

    def counts(self) -> dict[str, int]:
        """이유별 제외 건수(0건인 이유도 포함)와 합계."""
        out = {reason: self.excluded.get(reason, 0) for reason in EXCLUDE_REASONS}
        out["TOTAL"] = self.total
        out["KEPT_DRUM"] = len(self.drum)
        out["KEPT_KEYBOARD"] = len(self.keyboard)
        return out


def exclusion_reason(session: Session, config: FilterConfig = DEFAULT_CONFIG) -> str | None:
    """제외 이유 하나를 돌려준다(없으면 None). 비용이 싼 검사부터 하고 처음 걸린 이유를 쓴다."""
    if session.inconsistent:
        return CORRUPT
    if len(session.hits) > config.max_hits:
        return TOO_LARGE
    if session.mode not in SUPPORTED_MODES:
        return UNSUPPORTED_MODE
    if session.input_source not in (INPUT_STICK, INPUT_KEYBOARD):
        return CORRUPT
    if session.good_ms is None or session.perfect_ms is None or session.good_ms <= 0:
        return CORRUPT
    if _broken_order(session):
        return CORRUPT
    try:
        AnalysisRequest.model_validate(session.to_request())
    except ValidationError:
        return CORRUPT  # 오류 내용에는 값이 들어 있을 수 있어 이유만 남긴다

    notes = [h for h in session.hits if h["judgement"] in NOTE_JUDGEMENTS]
    if len(notes) < config.min_notes:
        return TOO_FEW_NOTES
    missed = sum(1 for h in notes if h["judgement"] == "MISS")
    if missed / len(notes) >= config.idle_miss_rate:
        return IDLE
    return None


def _broken_order(session: Session) -> bool:
    """`seq`가 겹치거나, `seq` 순서에 따라 시각이 거꾸로 가면 손상으로 본다."""
    seqs = [h["seq"] for h in session.hits]
    if any(s is None for s in seqs) or len(set(seqs)) != len(seqs):
        return True
    times = [h["t_ms"] for h in session.hits]
    if any(t is None for t in times):
        return True
    return any(b < a for a, b in zip(times, times[1:], strict=False))


def filter_sessions(sessions: list[Session], config: FilterConfig = DEFAULT_CONFIG) -> FilterResult:
    result = FilterResult(total=len(sessions))
    for session in sessions:
        reason = exclusion_reason(session, config)
        if reason is not None:
            result.excluded[reason] += 1
        elif session.input_source == INPUT_KEYBOARD:
            result.keyboard.append(session)
        else:
            result.drum.append(session)
    return result
