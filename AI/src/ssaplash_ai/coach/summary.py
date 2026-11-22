"""리포트 종합 총평(`summary`). 드럼 코치가 초보 연주자에게 직접 이야기해 주는 느낌의 규칙 문장이다.

순서는 전체 인상 → 잘한 점 하나 → 가장 심한 약점이 어떻게 나타났는지 → 먼저 연습할 것 하나다. 점수·정확도 숫자는 문장에 쓰지 않는다(BE가
따로 계산해 화면에 보여 주는 값과 어긋날 수 있다). 약점 목록과 노트 표에서 나온 값만 쓰는 순수 함수라
같은 입력은 항상 같은 문장이다. LLM을 쓰지 않는다.

임계값은 `config.py`의 가정값이다. 문구도 가정이며 첫 배포 뒤 피드백으로 이 파일에서만 고친다.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from ssaplash_ai.coach.advice import _eun, _label, _ro
from ssaplash_ai.coach.config import (
    STRENGTH_MIN_NOTES,
    STRENGTH_MIN_RATE,
    SUMMARY_GOOD_MISS_RATE,
    SUMMARY_GOOD_PERFECT_SHARE,
    SUMMARY_NEEDS_WORK_MISS_RATE,
)
from ssaplash_ai.coach.notes import NoteTable
from ssaplash_ai.coach.schema import Summary, WeakSegment

_HIGH = "HIGH"

_OPENING = {
    "GOOD": "정말 잘 쳤어요. 박자와 판정이 안정적이에요.",
    "FAIR": "기본기는 잘 잡혀 있어요. 조금만 다듬으면 훨씬 좋아질 거예요.",
    "NEEDS_WORK": "놓친 부분이 아직 있지만 연습하면 점점 좋아져요.",
}

_NO_WEAKNESS_TAIL = {
    "GOOD": "눈에 띄는 약점은 없었어요. 지금처럼 꾸준히 치면서 더 어려운 곡에도 도전해 보세요.",
    "FAIR": "눈에 띄는 약점은 없었어요. 같은 곡을 한 번 더 쳐 보며 감을 굳혀 보세요.",
    "NEEDS_WORK": "놓친 노트가 한 곳에 몰려 있지는 않아요. 쉬운 연습 단계부터 곡을 차근차근 익혀 보세요.",
}

_TOO_SHORT_TAIL = "곡이 짧아 자세한 분석은 하지 않았어요. 조금 더 긴 곡에서 약점을 확인해 보세요."


def _level(notes: NoteTable, segments: Sequence[WeakSegment]) -> str:
    miss_rate = float(notes.miss.mean())
    perfect_share = float(notes.perfect.mean())
    has_high = any(s.severityLevel == _HIGH for s in segments)
    if miss_rate >= SUMMARY_NEEDS_WORK_MISS_RATE:
        return "NEEDS_WORK"
    if (
        not has_high
        and miss_rate < SUMMARY_GOOD_MISS_RATE
        and perfect_share >= SUMMARY_GOOD_PERFECT_SHARE
    ):
        return "GOOD"
    return "FAIR"


def _strength_pad(notes: NoteTable, weak_pads: set[str]) -> str | None:
    """노트가 충분하고 적중률이 높은 패드 중 가장 높은 것. 동률이면 노트가 많은 쪽, 이름 순.

    약점으로 지목된 패드는 뺀다("잘 쳤어요"와 "먼저 연습하세요"가 같은 패드를 가리키지 않게).
    """
    best: tuple[float, int, str] | None = None
    pads = np.asarray(notes.pad)
    for pad in sorted(set(notes.pad) - weak_pads):
        mask = pads == pad
        count = int(mask.sum())
        if count < STRENGTH_MIN_NOTES:
            continue
        rate = 1.0 - float(notes.miss[mask].mean())
        if rate < STRENGTH_MIN_RATE:
            continue
        key = (rate, count, pad)
        if best is None or (key[0], key[1]) > (best[0], best[1]):
            best = key
    return best[2] if best else None


def _focus(segments: Sequence[WeakSegment]) -> WeakSegment | None:
    """가장 심한 약점. 동률이면 먼저 나온(시간이 빠른) 것."""
    if not segments:
        return None
    return max(segments, key=lambda s: (float(s.metrics.get("severity", 0.0)), -s.fromMs))


def _focus_phrase(segment: WeakSegment) -> str:
    """ "먼저 ~부터 연습해 보세요"에 들어갈 짧은 말. 뒤에 "연습"이 오므로 이 말에는 "연습"을 넣지 않는다."""
    pads = segment.pads
    pattern = segment.pattern
    if pattern == "TIMING_LATE":
        return "박에 맞춰 제때 치는 것"
    if pattern == "TIMING_EARLY":
        return "박을 기다렸다 치는 것"
    if pattern in ("PAD_LATE", "PAD_EARLY"):
        return f"{_label(pads, 0, '그 패드')} 박자 맞추기"
    if pattern in ("TRANSITION_LATE", "TRANSITION_MISS"):
        return f"{_label(pads, 0, '앞 패드')}에서 {_ro(_label(pads, 1, '다음 패드'))} 넘어가는 동작"
    if pattern == "HAND_WEAK":
        return "약한 쪽 손으로 고르게 치는 것"
    if pattern == "MISS_CLUSTER":
        return f"{round(segment.fromMs / 1000)}~{round(segment.toMs / 1000)}초 구간"
    if pattern == "UNSTEADY":
        return "일정한 간격으로 치는 것"
    return "가장 어려웠던 부분"


def _headline(level: str) -> str:
    """인상의 첫 문장. 화면이 이 문장을 제목으로 쓰고 나머지를 「자세한 분석」에 문장마다 한 줄로 보인다.

    인상을 두 문장 다 쓰면 자세한 분석이 4줄까지 늘어난다. 제목 한 줄과 자세한 분석 2~3줄이 되게 첫 문장만 쓴다.
    """
    return _OPENING[level].split(". ")[0].rstrip(".") + "."


def _what_happened(segment: WeakSegment) -> str:
    """가장 심한 약점이 어떻게 나타났는지 한 문장. 숫자는 쓰지 않는다(약점 카드가 보여 준다)."""
    pads = segment.pads
    pattern = segment.pattern
    if pattern == "TIMING_LATE":
        return "전체적으로 박보다 조금 늦게 치고 있어요."
    if pattern == "TIMING_EARLY":
        return "전체적으로 박보다 조금 빠르게 치고 있어요."
    if pattern == "PAD_LATE":
        return f"{_label(pads, 0, '한 패드')}만 다른 패드보다 늦게 쳐요."
    if pattern == "PAD_EARLY":
        return f"{_label(pads, 0, '한 패드')}만 다른 패드보다 빠르게 쳐요."
    if pattern in ("TRANSITION_LATE", "TRANSITION_MISS"):
        move = f"{_label(pads, 0, '앞 패드')}에서 {_ro(_label(pads, 1, '다음 패드'))} 넘어갈 때"
        tail = "박자가 늦어져요." if pattern == "TRANSITION_LATE" else "자주 놓쳐요."
        return f"{move} {tail}"
    if pattern == "HAND_WEAK":
        weak = {0: "왼손이 오른손", 1: "오른손이 왼손"}.get(segment.metrics.get("weakStickId"))
        return f"{weak or '한쪽 손이 다른 손'}보다 약하게 쳐요."
    if pattern == "MISS_CLUSTER":
        # 구간 위치는 바로 뒤 연습 문장("먼저 7~12초 구간부터")이 말한다. 같은 말을 두 번 하지 않는다
        return "한 구간에서 놓친 노트가 몰려 있어요."
    if pattern == "UNSTEADY":
        return "박자가 일정하지 않고 조금씩 흔들려요."
    return "아직 고르지 않은 부분이 있어요."


def build_brief_summary(notes: NoteTable) -> Summary:
    """약점 분석을 하지 않는 아주 짧은 곡의 총평. 등급은 놓침·PERFECT 비율로만 정한다."""
    level = _level(notes, [])
    return Summary(
        level=level,  # type: ignore[arg-type]
        text=f"{_OPENING[level]} {_TOO_SHORT_TAIL}",
        focusPattern=None,
        strengthPad=None,
        source="RULE",
    )


def build_summary(notes: NoteTable, segments: Sequence[WeakSegment]) -> Summary:
    """노트 표와 선택된 약점으로 총평을 만든다. `segments`가 비어 있으면 약점 없음 총평이다."""
    level = _level(notes, segments)
    focus = _focus(segments)
    strength = _strength_pad(notes, {pad for s in segments for pad in s.pads})

    parts: list[str] = []
    strength_line = (
        f"{_eun(_label([strength], 0, strength))} 특히 안정적으로 쳤어요." if strength else None
    )

    if focus is None:
        # 약점이 없으면 인상 대신 약점 없음 안내를 앞에 둔다(NEEDS_WORK에서 "정말 잘 쳤어요"가 나오지 않게)
        if level == "GOOD":
            parts.append(_headline("GOOD"))
        if strength_line:
            parts.append(strength_line)
        parts.append(_NO_WEAKNESS_TAIL[level])
    else:
        parts.append(_headline(level))
        if strength_line:
            parts.append(strength_line)
        # 화면은 첫 문장 뒤를 「자세한 분석」에 문장마다 한 줄로 보인다. 무엇을 연습할지 앞에 왜인지를 한 문장 둔다
        parts.append(_what_happened(focus))
        parts.append(f"먼저 {_focus_phrase(focus)}부터 연습해 보세요.")

    return Summary(
        level=level,  # type: ignore[arg-type]
        text=" ".join(parts),
        focusPattern=focus.pattern if focus else None,
        strengthPad=strength,
        source="RULE",
    )
