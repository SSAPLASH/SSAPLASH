"""놓침 원인 합성 시나리오가 심은 원인대로 재생되는지 확인한다(설계 COACH-001 6절 인수 조건)."""

from __future__ import annotations

from collections import Counter

from ssaplash_ai.coach_eval.chart import Note
from ssaplash_ai.coach_live_model.dataset import (
    CAUSE_FEATURE_NAMES,
    build_cause_rows,
    cause_play,
    chart_context,
)

ROWS = build_cause_rows(3)


def test_each_planted_cause_is_picked_most_often() -> None:
    for cause in ("WRONG_PAD", "TRANSITION", "DENSE", "DRIFT_LATE"):
        picked = Counter(r.picked for r in ROWS if r.scenario == cause)
        assert picked, cause
        assert picked.most_common(1)[0][0] == cause, (cause, picked)


def test_wrong_pad_names_the_pad_that_was_hit_instead() -> None:
    p = cause_play("WRONG_PAD", 0.9, seed=1)
    assert p.strays and {s.pad for s in p.strays} == {"MID_TOM"}


def test_rows_are_labelled_with_the_planted_cause() -> None:
    labels = {(r.scenario, r.label) for r in ROWS}
    assert ("NONE", "UNKNOWN") in labels
    assert all(r.label == r.scenario for r in ROWS if r.scenario != "NONE")
    assert all(len(r.features) == len(CAUSE_FEATURE_NAMES) for r in ROWS)
    # 원인은 2단계부터만 붙는다
    assert {r.stage for r in ROWS} <= {2, 3}


def test_same_arguments_give_the_same_play() -> None:
    a = cause_play("DENSE", 0.7, seed=5)
    b = cause_play("DENSE", 0.7, seed=5)
    assert a == b


def test_chart_context_groups_notes_at_the_same_time() -> None:
    chart = [
        Note("a", 1000.0, "KICK"),
        Note("b", 1000.0, "HIHAT"),
        Note("c", 1250.0, "SNARE"),
        Note("d", 1500.0, "SMALL_TOM"),
    ]
    ctx, median = chart_context(chart)
    assert ctx[0] == ((), None)
    assert ctx[1] == ((), None)
    assert ctx[2] == (("KICK", "HIHAT"), 250.0)
    assert ctx[3] == (("SNARE",), 250.0)
    assert median == 250.0
