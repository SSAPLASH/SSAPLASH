"""패턴 후보의 공통 모양과 도우미."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ssaplash_ai.coach.config import PAD_LABELS_KO
from ssaplash_ai.coach.notes import NoteTable


@dataclass(frozen=True)
class Candidate:
    """약점 후보 하나. `severity`로 순위를 매기고 응답 때 `WeakSegment`로 바뀐다."""

    pattern: str
    from_ms: float
    to_ms: float
    description: str
    cause_tags: list[str]
    pads: list[str]
    severity: float  # 0~1, 반올림 전 값
    metrics: dict[str, float | int | str] = field(default_factory=dict)


def clamp01(value: float) -> float:
    return float(min(1.0, max(0.0, value)))


def pad_label(pad: str) -> str:
    return PAD_LABELS_KO.get(pad, pad)


def whole_range(notes: NoteTable) -> tuple[float, float]:
    """전체 플레이 패턴의 범위: 첫 노트 시각 ~ 마지막 노트 시각 + 1 (끝 미포함 규칙)."""
    return float(notes.time[0]), float(notes.time[-1]) + 1.0


def sorted_pads(pads: list[str]) -> list[str]:
    return sorted(set(pads))


def seconds_text(ms: float) -> str:
    """문구용 초 단위 표기. 정수 초면 소수점 없이, 아니면 한 자리까지."""
    seconds = ms / 1000.0
    return f"{seconds:.0f}" if abs(seconds - round(seconds)) < 0.05 else f"{seconds:.1f}"


def mean_of(values: np.ndarray) -> float:
    return float(np.mean(values))
