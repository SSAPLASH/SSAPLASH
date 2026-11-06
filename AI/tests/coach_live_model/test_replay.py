"""Python 재생이 FE `coach/live`와 같은지 FE에서 뽑은 기록으로 확인한다.

기록은 합성 연주를 FE `LiveCoach`에 넣어 얻었다. FE 규칙이나 수치를 바꾸면 기록을 다시 뽑고 `replay.py`를 맞춘다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ssaplash_ai.coach_live_model.replay import JudgedNote, JudgedWindow, replay

FIXTURE = Path(__file__).parents[1] / "fixtures" / "coach_live" / "fe_replay.json"
PLAYS = json.loads(FIXTURE.read_text(encoding="utf-8"))


def notes_of(play: dict) -> list[JudgedNote]:
    return [JudgedNote(*n) for n in play["notes"]]


@pytest.mark.parametrize("play", PLAYS, ids=lambda p: p["scenario"])
def test_replay_fires_the_same_corrections_as_fe(play: dict) -> None:
    fired = replay(notes_of(play))
    expected = play["fired"]
    assert [(f.index, f.tag) for f in fired] == [(e["index"], e["tag"]) for e in expected]
    for f, e in zip(fired, expected, strict=True):
        target = e["target"]
        assert f.key == (e["tag"] if target is None else f"{e['tag']}:{target}")
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


def test_window_keeps_only_the_recent_notes() -> None:
    window = JudgedWindow()
    for i in range(40):
        window.push(JudgedNote(i * 500.0, "GOOD", 5.0, "SNARE", 0, 90))
    m = window.metrics()
    assert m.total == 40
    assert m.valid_count == 12
