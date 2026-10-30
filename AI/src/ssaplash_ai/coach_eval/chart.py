"""합성 채보: 노트(시각·패드) 열을 만든다. 실제 곡 채보를 읽지 않는다."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np

# 패드 배치 주기. 노트가 이 열을 돌아가며 놓인다.
LAYOUTS: dict[str, tuple[str, ...]] = {
    # 기본 록 비트: 하이햇이 절반, 킥·스네어가 각 1/4. 스네어는 항상 하이햇 다음에 온다.
    "rock": ("HIHAT", "KICK", "HIHAT", "SNARE", "HIHAT", "KICK", "HIHAT", "SNARE"),
    # 스네어 앞에 하이햇과 킥이 반반 와서, 전환(하이햇→스네어)과 패드(스네어)를 구분해서 볼 수 있다.
    "mixed": ("HIHAT", "SNARE", "KICK", "SNARE", "HIHAT", "SNARE", "KICK", "SNARE"),
    # 패드 8종 균등.
    "wide": ("HIHAT", "SNARE", "KICK", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE"),
}

# 주기 없이 무작위로 놓는 배치("random")의 패드 비율. 어떤 패드 앞에 무엇이 오는지 정해져 있지 않다.
RANDOM_WEIGHTS: dict[str, float] = {
    "HIHAT": 0.35,
    "SNARE": 0.20,
    "KICK": 0.20,
    "SMALL_TOM": 0.05,
    "MID_TOM": 0.05,
    "FLOOR_TOM": 0.05,
    "CRASH": 0.05,
    "RIDE": 0.05,
}
LAYOUT_NAMES = (*LAYOUTS, "random")

FIRST_NOTE_MS = 2000.0


@dataclass(frozen=True)
class Note:
    note_id: str
    time_ms: float
    pad: str


def make_chart(
    n_notes: int,
    layout: str = "rock",
    step_ms: float = 400.0,
    t0: float = FIRST_NOTE_MS,
    seed: int = 0,
) -> list[Note]:
    """`step_ms` 간격으로 `n_notes`개의 노트를 만든다. 같은 입력(`seed` 포함)이면 같은 채보다."""
    if layout == "random":
        rng = np.random.default_rng(seed)
        pads = rng.choice(list(RANDOM_WEIGHTS), size=n_notes, p=list(RANDOM_WEIGHTS.values()))
        return [Note(f"n{i + 1:04d}", t0 + i * step_ms, str(pad)) for i, pad in enumerate(pads)]
    cycle = LAYOUTS[layout]
    return [Note(f"n{i + 1:04d}", t0 + i * step_ms, cycle[i % len(cycle)]) for i in range(n_notes)]


def pad_counts(chart: list[Note]) -> Counter[str]:
    return Counter(note.pad for note in chart)
