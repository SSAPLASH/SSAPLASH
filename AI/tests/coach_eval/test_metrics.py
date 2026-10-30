"""시나리오 표와 일치 지표: 손으로 만든 사례로 계산이 맞는지, 켜 있는 pattern이 모두 다뤄지는지."""

from __future__ import annotations

import pytest

from ssaplash_ai.coach import AnalysisRequest
from ssaplash_ai.coach.config import ENABLED_PATTERNS
from ssaplash_ai.coach.schema import AnalysisResponse, WeakSegment
from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.metrics import (
    evaluate,
    false_positive_by_pattern,
    iou,
    summarize,
    wilson,
)
from ssaplash_ai.coach_eval.player import simulate
from ssaplash_ai.coach_eval.scenarios import (
    CLEAN,
    PLANTED,
    SCENARIOS_BY_NAME,
    Truth,
)


def _seg(pattern, from_ms=0.0, to_ms=1000.0, pads=()):
    return WeakSegment(
        fromMs=from_ms,
        toMs=to_ms,
        pattern=pattern,
        description="x",
        causeTags=[],
        pads=list(pads),
        metrics={"severity": 0.5},
    )


def _response(*segments):
    return AnalysisResponse(
        analyzerVersion="t", reason="OK" if segments else "NO_WEAKNESS", weakSegments=list(segments)
    )


def test_wilson_matches_known_values():
    low, high = wilson(0, 10)
    assert low == 0.0 and high == pytest.approx(0.278, abs=0.002)
    low, high = wilson(10, 10)
    assert low == pytest.approx(0.722, abs=0.002) and high == 1.0
    low, high = wilson(5, 10)
    assert (low, high) == (pytest.approx(0.237, abs=0.002), pytest.approx(0.763, abs=0.002))
    assert wilson(0, 0) == (0.0, 1.0)


def test_iou():
    assert iou((0, 10), (0, 10)) == 1.0
    assert iou((0, 10), (5, 15)) == pytest.approx(1 / 3)
    assert iou((0, 10), (20, 30)) == 0.0


def test_every_enabled_pattern_has_a_planted_scenario():
    covered = {
        p for s in PLANTED for p in s.truth(s.strengths[0], make_chart(60, s.layout)).expected
    }
    assert covered == set(ENABLED_PATTERNS)


def test_strengths_have_four_or_more_steps_and_monotone_toward_stronger():
    for s in PLANTED:
        assert len(s.strengths) >= 4
        ordered = list(s.strengths)
        # 약점이 강해지는 방향은 시나리오마다 다르다(세기 비율은 작아질수록 강함). 한 방향 단조여야 한다
        assert ordered == sorted(ordered) or ordered == sorted(ordered, reverse=True)


@pytest.mark.parametrize("scenario", [*PLANTED, *CLEAN], ids=lambda s: s.name)
def test_scenario_builds_valid_requests_at_every_strength(scenario):
    chart = make_chart(80, scenario.layout)
    for strength in scenario.strengths:
        model = scenario.build(strength, chart)
        request = simulate(chart, model, good_ms=60.0, seed=1).request
        AnalysisRequest.model_validate(request)


def test_detected_when_expected_pattern_present_and_extras_are_split():
    scenario = SCENARIOS_BY_NAME["TRANSITION_LATE"]
    truth = Truth(
        expected=("TRANSITION_LATE",),
        pads=("HIHAT", "SNARE"),
        span=(0.0, 1000.0),
        allowed_extra=frozenset({"PAD_LATE"}),
    )
    response = _response(
        _seg("TRANSITION_LATE", 100, 900, ("HIHAT", "SNARE")),
        _seg("PAD_LATE"),
        _seg("UNSTEADY"),
    )
    trial = evaluate(response, scenario, 0.7, truth)
    assert trial.detected and trial.location_ok and trial.pads_ok
    assert trial.cross == ("UNSTEADY",)
    assert trial.allowed == ("PAD_LATE",)
    assert not trial.false_positive


def test_not_detected_when_other_pattern_only():
    scenario = SCENARIOS_BY_NAME["TIMING_LATE"]
    trial = evaluate(_response(_seg("UNSTEADY")), scenario, 0.4, Truth(expected=("TIMING_LATE",)))
    assert not trial.detected
    assert trial.location_ok is None and trial.pads_ok is None
    assert trial.cross == ("UNSTEADY",)


def test_wrong_location_and_pads_are_reported_when_detected():
    scenario = SCENARIOS_BY_NAME["MISS_CLUSTER"]
    truth = Truth(expected=("MISS_CLUSTER",), pads=("SNARE",), span=(0.0, 1000.0))
    trial = evaluate(_response(_seg("MISS_CLUSTER", 5000, 6000, ("KICK",))), scenario, 0.6, truth)
    assert trial.detected
    assert trial.location_ok is False
    assert trial.pads_ok is False


def test_clean_scenario_counts_any_segment_as_false_positive():
    scenario = SCENARIOS_BY_NAME["CLEAN_AVERAGE"]
    clean = evaluate(_response(), scenario, 0.0, Truth(expected=()))
    flagged = evaluate(_response(_seg("PAD_LATE")), scenario, 0.0, Truth(expected=()))
    assert not clean.false_positive
    assert flagged.false_positive and not flagged.detected


def test_summarize_and_false_positive_breakdown():
    clean = SCENARIOS_BY_NAME["CLEAN_NOVICE"]
    empty = Truth(expected=())
    trials = [
        evaluate(_response(), clean, 0.0, empty),
        evaluate(_response(_seg("PAD_LATE"), _seg("UNSTEADY")), clean, 0.0, empty),
        evaluate(_response(_seg("PAD_LATE")), clean, 0.0, empty),
        evaluate(_response(), clean, 0.0, empty),
    ]
    cells = summarize(trials)
    assert len(cells) == 1
    cell = cells[0]
    assert cell.n == 4 and cell.false_positive == 2 and cell.fp_rate == 0.5
    assert false_positive_by_pattern(cells) == {"PAD_LATE": (2, 4), "UNSTEADY": (1, 4)}


def test_summarize_detection_rate_and_location_rate():
    scenario = SCENARIOS_BY_NAME["MISS_CLUSTER"]
    truth = Truth(expected=("MISS_CLUSTER",), span=(0.0, 1000.0))
    trials = [
        evaluate(_response(_seg("MISS_CLUSTER", 0, 900)), scenario, 0.6, truth),
        evaluate(_response(_seg("MISS_CLUSTER", 8000, 9000)), scenario, 0.6, truth),
        evaluate(_response(), scenario, 0.6, truth),
        evaluate(_response(), scenario, 0.6, truth),
    ]
    (cell,) = summarize(trials)
    assert cell.detection_rate == 0.5
    assert (cell.location_ok, cell.location_n) == (1, 2)
