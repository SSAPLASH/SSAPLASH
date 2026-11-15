"""Python 재생이 FE `coach/live`와 같은지 FE에서 뽑은 기록으로 확인한다.

기록은 합성 연주를 FE `LiveCoach`에 넣어 얻었다. FE 규칙이나 수치를 바꾸면 기록을 다시 뽑고 `replay.py`를 맞춘다.
판정 단계(띄우는 시점)와 놓침 원인(후보·고른 원인)까지 같아야 한다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ssaplash_ai.coach_live_model.replay import (
    CauseCandidate,
    JudgedNote,
    JudgedWindow,
    StrayHit,
    coach_stage,
    miss_causes,
    pick_cause_by_rule,
    replay,
)

FIXTURE = Path(__file__).parents[1] / "fixtures" / "coach_live" / "fe_replay.json"
PLAYS = json.loads(FIXTURE.read_text(encoding="utf-8"))


def notes_of(play: dict) -> list[JudgedNote]:
    out = []
    for n in play["notes"]:
        song, judgement, delta, pad, stick, velocity, note_time, prev_pads, prev_gap = n
        out.append(
            JudgedNote(
                song,
                judgement,
                delta,
                pad,
                stick,
                velocity,
                note_time,
                None if prev_pads is None else tuple(prev_pads),
                None if prev_pads is None else prev_gap,
            )
        )
    return out


def strays_of(play: dict) -> list[StrayHit]:
    return [StrayHit(pad, t) for pad, t in play["strays"]]


def candidate_json(c: CauseCandidate) -> dict:
    out: dict = {"cause": c.cause, "strength": round(c.strength, 3), "pad": c.pad}
    if c.from_pad:
        out["fromPad"] = c.from_pad
    if c.into_pad:
        out["intoPad"] = c.into_pad
    return out


@pytest.mark.parametrize("play", PLAYS, ids=lambda p: p["scenario"])
def test_replay_fires_the_same_corrections_as_fe(play: dict) -> None:
    fired = replay(notes_of(play), strays_of(play), play["noteGapMedianMs"])
    expected = play["fired"]
    assert [(f.index, f.tag) for f in fired] == [(e["index"], e["tag"]) for e in expected]
    for f, e in zip(fired, expected, strict=True):
        target = e["target"]
        assert f.key == (e["tag"] if target is None else f"{e['tag']}:{target}")
        assert f.stage == e["stage"]
        assert (None if f.cause is None else f.cause.cause) == e["cause"]
        assert [candidate_json(c) for c in f.candidates] == e["candidates"]
        assert f.metrics.valid_count == e["validCount"]
        assert f.metrics.mean_delta == pytest.approx(e["meanDelta"])
        assert f.metrics.std_delta == pytest.approx(e["stdDelta"])
        assert f.metrics.same_sign_ratio == pytest.approx(e["sameSignRatio"])
        assert f.metrics.miss_in_window == e["missInWindow"]
        assert f.metrics.miss_in_recent == e["missInRecent"]
        assert f.metrics.trailing_misses == e["trailingMisses"]
        assert f.metrics.miss_in_pad_window == e["missInPadWindow"]


def test_fixture_covers_the_tags_the_model_gates() -> None:
    tags = {e["tag"] for p in PLAYS for e in p["fired"]}
    assert {"LIVE_LATE", "LIVE_EARLY", "LIVE_PAD_LATE", "LIVE_HAND_WEAK", "LIVE_PAD_MISS"} <= tags


def test_fixture_covers_every_stage_and_cause() -> None:
    fired = [e for p in PLAYS for e in p["fired"]]
    assert {e["stage"] for e in fired} == {1, 2, 3}
    assert {e["cause"] for e in fired} >= {
        "WRONG_PAD",
        "TRANSITION",
        "DENSE",
        "DRIFT_LATE",
        "UNKNOWN",
    }


def test_window_keeps_only_the_recent_notes() -> None:
    window = JudgedWindow()
    for i in range(40):
        window.push(JudgedNote(i * 500.0, "GOOD", 5.0, "SNARE", 0, 90))
    m = window.metrics()
    assert m.total == 40
    assert m.valid_count == 12


def test_stage_follows_the_judged_count() -> None:
    assert [coach_stage(n) for n in (0, 3, 4, 7, 8, 15, 16, 200)] == [0, 0, 1, 1, 2, 2, 3, 3]


def test_stage_one_shows_only_the_miss_streak() -> None:
    # 처음부터 늦게 치고 계속 놓쳐도, 판정 8개 전에는 연속 놓침만 뜬다
    notes = [JudgedNote(i * 500.0, "MISS", None, "SNARE", None, None) for i in range(7)]
    fired = replay(notes)
    assert [f.tag for f in fired] == ["LIVE_MISS_STREAK"]
    assert fired[0].stage == 1
    assert fired[0].cause is None


def test_pick_cause_follows_the_rule_order() -> None:
    dense = CauseCandidate("DENSE", 1.0, None)
    wrong = CauseCandidate("WRONG_PAD", 0.5, None)
    assert pick_cause_by_rule([dense, wrong]).cause == "WRONG_PAD"
    assert pick_cause_by_rule([]).cause == "UNKNOWN"


def _transition_notes(contrast_misses: tuple[int, ...] = ()) -> list[JudgedNote]:
    """스네어 → 스몰탐에서만 놓치고, 하이햇 → 스몰탐(비교 대상)은 친다. FE `cause.test.ts`와 같은 연주."""
    notes = []
    for k in range(4):
        base = 4 * k
        t = [4_000.0 + (base + j) * 500.0 for j in range(4)]
        notes.append(JudgedNote(t[0], "GOOD", 0.0, "SNARE", 0, 90, t[0], ("SMALL_TOM",), 500.0))
        notes.append(
            JudgedNote(t[1] + 60, "MISS", None, "SMALL_TOM", None, None, t[1], ("SNARE",), 500.0)
        )
        notes.append(JudgedNote(t[2], "GOOD", 0.0, "HIHAT", 0, 90, t[2], ("SMALL_TOM",), 500.0))
        if base + 3 in contrast_misses:
            notes.append(
                JudgedNote(
                    t[3] + 60, "MISS", None, "SMALL_TOM", None, None, t[3], ("HIHAT",), 500.0
                )
            )
        else:
            notes.append(JudgedNote(t[3], "GOOD", 0.0, "SMALL_TOM", 1, 90, t[3], ("HIHAT",), 500.0))
    return notes


def test_transition_needs_a_contrast_that_is_missed_less() -> None:
    causes = lambda notes: [c.cause for c in miss_causes(notes, [], 3, 500.0)]  # noqa: E731
    assert causes(_transition_notes()) == ["TRANSITION"]
    # 비교 대상이 없으면 이동 탓인지 가를 수 없다
    only = [
        n for n in _transition_notes() if not (n.pad == "SMALL_TOM" and n.prev_pads == ("HIHAT",))
    ]
    assert "TRANSITION" not in causes(only)
    # 비교 대상도 절반을 놓치면 이동 탓이 아니고, 하나만 놓치면 이동 탓이다
    assert "TRANSITION" not in causes(_transition_notes((3, 7)))
    assert "TRANSITION" in causes(_transition_notes((3,)))


def test_causes_are_not_computed_below_stage_two() -> None:
    notes = [
        JudgedNote(i * 500.0, "MISS", None, "SNARE", None, None, prev_gap_ms=100.0)
        for i in range(4)
    ]
    assert miss_causes(notes, [], 1, 500.0) == []
    assert [c.cause for c in miss_causes(notes, [], 2, 500.0)] == ["DENSE"]
