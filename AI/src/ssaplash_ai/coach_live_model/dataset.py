"""합성 연주에서 "이 지적을 띄울까"의 학습 데이터를 만든다.

라벨은 시나리오가 심은 약점이다. 심은 약점과 같은 지적이면 1, 약점이 없는 연주에서 우연히 뜬 지적이면 0이다.
합성 연주는 판 내내 오차 분포가 같아서, 여기서 좋은 성능이 실제 성능을 보장하지 않는다.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import numpy as np

from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.player import PlayerModel, simulate
from ssaplash_ai.coach_eval.scenarios import SCENARIOS, SKILLS
from ssaplash_ai.coach_live_model.replay import JudgedNote, WindowMetrics, replay

GOOD_MS = 60.0
TAGS = (
    "LIVE_MISS_STREAK",
    "LIVE_LATE",
    "LIVE_EARLY",
    "LIVE_PAD_LATE",
    "LIVE_PAD_EARLY",
    "LIVE_HAND_WEAK",
    "LIVE_UNSTEADY",
    "LIVE_PAD_MISS",
)
FEATURE_NAMES = (
    "absMean",
    "sameSign",
    "std",
    "valid",
    "missInWindow",
    "missInRecent",
    "trailing",
    "topPadCount",
    "topPadDiff",
    "topPadSameSign",
    "handRatio",
    "progress",
    *(f"tag:{t}" for t in TAGS),
)

TRUE_PAIRS = {
    ("TIMING_LATE", "LIVE_LATE"),
    ("TIMING_EARLY", "LIVE_EARLY"),
    ("PAD_LATE", "LIVE_PAD_LATE"),
    ("PAD_EARLY", "LIVE_PAD_EARLY"),
    ("HAND_WEAK", "LIVE_HAND_WEAK"),
    ("UNSTEADY", "LIVE_UNSTEADY"),
    ("MISS_CLUSTER", "LIVE_MISS_STREAK"),
    ("PAD_MISS", "LIVE_PAD_MISS"),
}
# 패드 놓침 시나리오는 coach_eval에 없어서 평균 연주의 그 패드 노트를 놓침으로 바꿔 만든다
PAD_MISS_TARGET = "SNARE"
PAD_MISS_STRENGTHS = (0.3, 0.5, 0.7, 0.9)


@dataclass(frozen=True)
class Row:
    play_id: int
    scenario: str
    strength: float
    tag: str
    features: tuple[float, ...]
    label: int


def is_ambiguous(scenario: str, tag: str) -> bool:
    """맞고 틀림을 가를 수 없는 지적. 학습에서 뺀다."""
    if scenario.startswith("TRANSITION"):
        return True
    if scenario == "CLEAN_NOVICE" and tag in ("LIVE_MISS_STREAK", "LIVE_UNSTEADY", "LIVE_PAD_MISS"):
        return True  # 초보는 실제로 많이 놓치고 흔들려서 오탐이라고 할 수 없다
    return (scenario, tag) in {("MISS_CLUSTER", "LIVE_PAD_MISS"), ("PAD_MISS", "LIVE_MISS_STREAK")}


def features(m: WindowMetrics, tag: str) -> tuple[float, ...]:
    """모델 입력. FE `coach/live/gate`도 같은 순서·같은 식으로 만든다."""
    top = max(m.pads, key=lambda p: p.count, default=None)
    h0, h1 = m.hands
    ratio = 1.0
    if h0.count > 0 and h1.count > 0 and max(h0.mean_velocity, h1.mean_velocity) > 0:
        ratio = min(h0.mean_velocity, h1.mean_velocity) / max(h0.mean_velocity, h1.mean_velocity)
    mean = m.mean_delta or 0.0
    return (
        abs(mean) / 60.0,
        m.same_sign_ratio or 0.0,
        (m.std_delta or 0.0) / 60.0,
        m.valid_count / 12.0,
        m.miss_in_window / 12.0,
        m.miss_in_recent / 6.0,
        m.trailing_misses / 6.0,
        (top.count if top else 0) / 12.0,
        abs(top.mean_delta - mean) / 60.0 if top else 0.0,
        top.same_sign_ratio if top else 0.0,
        ratio,
        min(1.0, m.total / 200.0),
        *(1.0 if t == tag else 0.0 for t in TAGS),
    )


def notes_from_hits(hits: list[dict[str, Any]]) -> list[JudgedNote]:
    """판정이 있는 타격만 곡 시각 순으로 고른다."""
    judged = [h for h in hits if h.get("judgement") is not None]
    judged.sort(key=lambda h: h["tMs"])
    return [
        JudgedNote(
            float(h["tMs"]),
            h["judgement"],
            h.get("deltaMs"),
            h["pad"],
            h.get("stickId"),
            h.get("velocity"),
        )
        for h in judged
    ]


def _miss_pad(notes: list[JudgedNote], strength: float, seed: int) -> list[JudgedNote]:
    rng = np.random.default_rng(seed)
    out = []
    for n in notes:
        if n.pad == PAD_MISS_TARGET and n.judgement != "MISS" and rng.random() < strength:
            out.append(JudgedNote(n.song_time_ms, "MISS", None, n.pad, None, None))
        else:
            out.append(n)
    return out


def _play(layout: str, model: PlayerModel, seed: int, k: int) -> list[JudgedNote]:
    chart = make_chart((200, 600)[k % 2], layout, seed=seed)
    return notes_from_hits(simulate(chart, model, good_ms=GOOD_MS, seed=seed).request["hits"])


def synthetic_plays(per_cell: int) -> Iterator[tuple[str, float, list[JudgedNote]]]:
    """(시나리오, 강도, 판정 목록). 같은 인자면 같은 결과다."""
    for si, s in enumerate(SCENARIOS):
        for strength in s.strengths or (0.0,):
            for k in range(per_cell):
                seed = si * 100003 + int(strength * 1000) * 131 + k
                chart = make_chart((200, 600)[k % 2], s.layout, seed=seed)
                model = s.build(strength, chart)
                yield (
                    s.name,
                    strength,
                    notes_from_hits(
                        simulate(chart, model, good_ms=GOOD_MS, seed=seed).request["hits"]
                    ),
                )
    for strength in PAD_MISS_STRENGTHS:
        for k in range(per_cell):
            seed = 900_001 + int(strength * 1000) * 131 + k
            yield (
                "PAD_MISS",
                strength,
                _miss_pad(_play("random", SKILLS["CLEAN_AVERAGE"], seed, k), strength, seed),
            )


def build_rows(per_cell: int) -> list[Row]:
    rows: list[Row] = []
    for play_id, (scenario, strength, notes) in enumerate(synthetic_plays(per_cell)):
        for f in replay(notes):
            if is_ambiguous(scenario, f.tag):
                continue
            label = 1 if (scenario, f.tag) in TRUE_PAIRS else 0
            rows.append(Row(play_id, scenario, strength, f.tag, features(f.metrics, f.tag), label))
    return rows
