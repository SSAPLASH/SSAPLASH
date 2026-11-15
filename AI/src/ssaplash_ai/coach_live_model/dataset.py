"""합성 연주에서 "이 지적을 띄울까"의 학습 데이터를 만든다.

라벨은 시나리오가 심은 약점이다. 심은 약점과 같은 지적이면 1, 약점이 없는 연주에서 우연히 뜬 지적이면 0이다.
합성 연주는 판 내내 오차 분포가 같아서, 여기서 좋은 성능이 실제 성능을 보장하지 않는다.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import numpy as np

from ssaplash_ai.coach_eval.chart import LAYOUTS, Note, make_chart
from ssaplash_ai.coach_eval.player import PlayerModel, simulate
from ssaplash_ai.coach_eval.scenarios import SCENARIOS, SKILLS
from ssaplash_ai.coach_live_model.replay import (
    RULE_ORDER,
    Firing,
    JudgedNote,
    StrayHit,
    WindowMetrics,
    replay,
)

GOOD_MS = 60.0
# 입력 계산 버전. `features()`의 순서·식을 바꾸면 올린다. FE `coach/live/gate`도 같은 값을 알고 있어서,
# 서버에서 받은 모델의 `meta.json` 값이 다르면 FE가 그 모델을 쓰지 않는다(설계 3.4)
FEATURE_VERSION = 1
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


# ---------------------------------------------------------------------------
# 놓침 원인 합성 시나리오(설계 COACH-001 3.1, C5)
#
# 원인마다 그 원인으로만 놓치는 연주를 만든다. 라벨은 심은 원인이고, 원인 없이 가끔 놓치는 대조군은 UNKNOWN이다.
# FE처럼 판정은 들어오는 순서로 넣는다: 맞힌 노트는 친 시각, 놓친 노트는 판정 폭이 지난 뒤(노트 시각 + goodMs).
# 원인 모델(R1 이후)의 학습 자료이자, 규칙이 심은 원인을 맞게 고르는지 보는 시험 자료다.
# ---------------------------------------------------------------------------

CHORD_MS = 1.0
CAUSE_SCENARIOS = ("WRONG_PAD", "TRANSITION", "DENSE", "DRIFT_LATE", "NONE")
CAUSE_STRENGTHS = (0.5, 0.7, 0.9)
# 다른 패드: 스몰탐을 칠 차례에 미드탐을 친다
WRONG_PAD_FROM, WRONG_PAD_INTO = "SMALL_TOM", "MID_TOM"
WRONG_PAD_LAYOUT = ("SNARE", "SMALL_TOM", "HIHAT", "SMALL_TOM")
# 패드 이동: 하이햇에서 스네어로 넘어갈 때 놓친다(coach_eval의 전환 약점과 같은 이동)
TRANSITION_PADS = ("HIHAT", "SNARE")
# 빠른 구간: 보통 간격 400ms 사이에 150ms 간격의 몰아치기가 들어간다
DENSE_STEP_MS, DENSE_FAST_MS = 400.0, 150.0
# 원인 모델 입력 계산 버전. `cause_features()`를 바꾸면 올린다. FE `coach/live/models/remoteCause.ts`와 같아야 한다
CAUSE_FEATURE_VERSION = 1
CAUSE_FEATURE_NAMES = (
    *(f"strength:{c}" for c in RULE_ORDER),
    "stage3",
    "padMiss",
)


@dataclass(frozen=True)
class CausePlay:
    scenario: str
    strength: float
    notes: list[JudgedNote]
    strays: list[StrayHit]
    note_gap_median_ms: float | None


@dataclass(frozen=True)
class CauseRow:
    play_id: int
    scenario: str
    strength: float
    tag: str
    stage: int
    picked: str
    candidates: tuple[str, ...]
    features: tuple[float, ...]
    # 심은 원인. 대조군은 UNKNOWN
    label: str


def chart_context(
    chart: list[Note],
) -> tuple[list[tuple[tuple[str, ...], float | None]], float | None]:
    """노트마다 (직전 시점의 패드들, 직전 시점과의 간격)과 간격 중앙값. FE `chartCoachContext`와 같다."""
    order = sorted(range(len(chart)), key=lambda i: chart[i].time_ms)
    groups: list[tuple[float, list[str], list[int]]] = []
    for i in order:
        n = chart[i]
        if groups and n.time_ms - groups[-1][0] <= CHORD_MS:
            if n.pad not in groups[-1][1]:
                groups[-1][1].append(n.pad)
            groups[-1][2].append(i)
        else:
            groups.append((n.time_ms, [n.pad], [i]))
    out: list[tuple[tuple[str, ...], float | None]] = [((), None)] * len(chart)
    gaps: list[float] = []
    for gi, (t, _pads, members) in enumerate(groups):
        prev = groups[gi - 1] if gi > 0 else None
        gap = None if prev is None else t - prev[0]
        if gap is not None:
            gaps.append(gap)
        ctx = (tuple(prev[1]) if prev else (), gap)
        for i in members:
            out[i] = ctx
    return out, (float(np.median(gaps)) if gaps else None)


def _dense_chart(n_notes: int) -> list[Note]:
    """보통 간격 6개 뒤에 빠른 간격 4개가 오는 채보. 패드는 록 비트를 돈다."""
    cycle = LAYOUTS["rock"]
    notes: list[Note] = []
    t = 2000.0
    for i in range(n_notes):
        notes.append(Note(f"n{i + 1:04d}", t, cycle[i % len(cycle)]))
        t += DENSE_FAST_MS if i % 10 >= 6 else DENSE_STEP_MS
    return notes


def _cycle_chart(cycle: tuple[str, ...], n_notes: int) -> list[Note]:
    return [
        Note(f"n{i + 1:04d}", 2000.0 + i * DENSE_STEP_MS, cycle[i % len(cycle)])
        for i in range(n_notes)
    ]


def _cause_chart(scenario: str, n_notes: int, seed: int) -> list[Note]:
    if scenario == "WRONG_PAD":
        # 스몰탐이 절반이어야 패드 놓침 지적이 뜰 만큼 놓친다
        return _cycle_chart(WRONG_PAD_LAYOUT, n_notes)
    if scenario == "TRANSITION":
        return make_chart(n_notes, "mixed", seed=seed)
    if scenario == "DENSE":
        return _dense_chart(n_notes)
    return make_chart(n_notes, "rock", seed=seed)


def _judged(
    arrival: float,
    judgement: str,
    delta: float | None,
    note: Note,
    stick: int | None,
    velocity: float | None,
    prev: tuple[tuple[str, ...], float | None],
) -> JudgedNote:
    return JudgedNote(
        arrival, judgement, delta, note.pad, stick, velocity, note.time_ms, prev[0], prev[1]
    )


def cause_play(scenario: str, strength: float, seed: int, n_notes: int = 200) -> CausePlay:
    """심은 원인으로 놓치는 연주. 같은 인자면 같은 결과다."""
    rng = np.random.default_rng(seed)
    chart = _cause_chart(scenario, n_notes, seed)
    ctx, median = chart_context(chart)
    # 대조군은 원인 없이 자주 놓쳐야 놓침 지적이 뜬다
    base_p_miss = 0.2 if scenario == "NONE" else 0.01
    judged: list[JudgedNote] = []
    strays: list[StrayHit] = []
    drift_phrase = False

    for i, note in enumerate(chart):
        prev_pads, prev_gap = ctx[i]
        delta = float(rng.normal(0.0, 0.2)) * GOOD_MS
        miss = bool(rng.random() < base_p_miss)
        into: str | None = None

        if scenario == "WRONG_PAD" and note.pad == WRONG_PAD_FROM and rng.random() < strength:
            miss, into = True, WRONG_PAD_INTO
        elif scenario == "TRANSITION" and prev_pads[:1] == TRANSITION_PADS[:1]:
            if note.pad == TRANSITION_PADS[1]:
                miss = miss or bool(rng.random() < strength)
        elif scenario == "DENSE" and prev_gap is not None and median is not None:
            if prev_gap <= 0.6 * median:
                miss = miss or bool(rng.random() < strength * 0.6)
        elif scenario == "DRIFT_LATE":
            # 8노트 마디의 뒤쪽에서 점점 늦어지다(3·4·5번째) 6·7·8번째를 놓친다
            pos = i % 8
            if pos == 0:
                drift_phrase = bool(rng.random() < strength)
            if drift_phrase and pos in (2, 3, 4):
                delta = (0.15 + 0.2 * (pos - 2) + float(rng.normal(0.0, 0.03))) * GOOD_MS
                miss = False
            elif drift_phrase and pos in (5, 6, 7):
                miss = True

        stick = i % 2
        if miss:
            # 놓친 노트는 판정 폭이 지난 뒤에 들어온다
            judged.append(_judged(note.time_ms + GOOD_MS, "MISS", None, note, None, None, ctx[i]))
            if into is not None:
                hit_at = note.time_ms + float(rng.normal(0.0, 0.15)) * GOOD_MS
                strays.append(StrayHit(into, hit_at))
            continue
        delta = max(-GOOD_MS + 1.0, min(GOOD_MS - 1.0, delta))
        judgement = "PERFECT" if abs(delta) <= 25.0 else "GOOD"
        velocity = float(np.clip(round(float(rng.normal(90.0, 10.0))), 1, 127))
        judged.append(
            _judged(note.time_ms + delta, judgement, delta, note, stick, velocity, ctx[i])
        )

    judged.sort(key=lambda n: n.song_time_ms)
    return CausePlay(scenario, strength, judged, strays, median)


def cause_plays(per_cell: int) -> Iterator[CausePlay]:
    """(시나리오 × 강도 × per_cell)개의 원인 연주. 같은 인자면 같은 결과다."""
    for si, scenario in enumerate(CAUSE_SCENARIOS):
        strengths = (0.0,) if scenario == "NONE" else CAUSE_STRENGTHS
        for strength in strengths:
            for k in range(per_cell):
                seed = 700_001 + si * 10_007 + int(strength * 100) * 131 + k
                yield cause_play(scenario, strength, seed)


def cause_features(f: Firing) -> tuple[float, ...]:
    """원인 모델 입력 후보. 규칙 후보의 강도(없으면 0), 3단계 여부, 패드 놓침 지적 여부."""
    strengths = {c.cause: c.strength for c in f.candidates}
    return (
        *(strengths.get(c, 0.0) for c in RULE_ORDER),
        1.0 if f.stage >= 3 else 0.0,
        1.0 if f.tag == "LIVE_PAD_MISS" else 0.0,
    )


def build_cause_rows(per_cell: int) -> list[CauseRow]:
    """원인을 고른 놓침 지적마다 한 행. 라벨은 심은 원인이다."""
    rows: list[CauseRow] = []
    for play_id, p in enumerate(cause_plays(per_cell)):
        label = "UNKNOWN" if p.scenario == "NONE" else p.scenario
        for f in replay(p.notes, p.strays, p.note_gap_median_ms):
            if f.cause is None:
                continue
            rows.append(
                CauseRow(
                    play_id,
                    p.scenario,
                    p.strength,
                    f.tag,
                    f.stage,
                    f.cause.cause,
                    tuple(c.cause for c in f.candidates),
                    cause_features(f),
                    label,
                )
            )
    return rows
