"""분포와 걸림 비율: 패턴당 세션 한 번, 윌슨 구간, 소규모 셀 가림, 알려진 값의 분포."""

from __future__ import annotations

import json

import pytest

from calibration_helpers import synthetic_request, view_rows
from ssaplash_ai.coach.config import ENABLED_PATTERNS
from ssaplash_ai.coach.schema import AnalysisResponse, WeakSegment
from ssaplash_ai.coach_calibration.filters import FilterResult
from ssaplash_ai.coach_calibration.profile import (
    GROUP_DRUM,
    GROUP_KEYBOARD,
    MIN_CELL,
    FlagRate,
    build_profile,
    build_profiles,
    flag_rates,
)
from ssaplash_ai.coach_calibration.source import ListSource, Session, read_sessions
from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.metrics import wilson
from ssaplash_ai.coach_eval.player import PlayerModel, simulate

PRECISE = {"sigma": 0.001, "p_miss": 0.0, "p_stray": 0.0}  # 정답을 알 수 있는 거의 완벽한 연주


def _sessions(count: int, model: PlayerModel, layout: str = "rock", n_notes: int = 80, **view):
    out: list[Session] = []
    for i in range(count):
        chart = make_chart(n_notes, layout, seed=i)
        request = simulate(chart, model, good_ms=60.0, seed=i).request
        request["playId"] = f"s{i:03d}-{model.mean}-{model.weak_stick}"
        out.extend(read_sessions(ListSource(view_rows(request, **view))))
    return out


def _response(*patterns: str) -> AnalysisResponse:
    segments = [
        WeakSegment(
            fromMs=float(i),
            toMs=float(i) + 1,
            pattern=p,
            description="x",
            causeTags=[],
            pads=[],
            metrics={"severity": 0.5},
        )
        for i, p in enumerate(patterns)
    ]
    return AnalysisResponse(
        analyzerVersion="t", reason="OK" if segments else "NO_WEAKNESS", weakSegments=segments
    )


def test_a_pattern_is_counted_once_per_session_even_with_several_segments():
    rates, any_flag, mean_segments = flag_rates(
        [_response("MISS_CLUSTER", "MISS_CLUSTER", "PAD_LATE"), _response(), _response("PAD_LATE")]
    )
    by = {r.pattern: r for r in rates}

    assert by["MISS_CLUSTER"].sessions_flagged == 1
    assert by["PAD_LATE"].sessions_flagged == 2
    assert any_flag.sessions_flagged == 2
    assert mean_segments == pytest.approx(4 / 3)


def test_every_enabled_pattern_is_listed_even_at_zero():
    rates, _, _ = flag_rates([_response()])

    assert set(ENABLED_PATTERNS) <= {r.pattern for r in rates}
    assert all(r.sessions_flagged == 0 for r in rates)


def test_flag_rate_uses_the_wilson_interval():
    fr = FlagRate("X", 3, 20)

    assert fr.rate == pytest.approx(0.15)
    assert fr.ci == wilson(3, 20)


def test_known_late_players_are_flagged_and_precise_players_are_not():
    late = _sessions(10, PlayerModel(mean=0.6, sigma=0.2, p_miss=0.0, p_stray=0.0))
    precise = _sessions(10, PlayerModel(**PRECISE))

    late_profile = build_profile(GROUP_DRUM, late)
    precise_profile = build_profile(GROUP_DRUM, precise)

    late_rates = {r.pattern: r for r in late_profile.flag_rates}
    assert late_rates["TIMING_LATE"].sessions_flagged == 10
    assert all(r.sessions_flagged == 0 for r in precise_profile.flag_rates)
    assert precise_profile.any_flag.sessions_flagged == 0


def test_distributions_match_known_values():
    model = PlayerModel(mean=0.2, **PRECISE)
    profile = build_profile(GROUP_DRUM, _sessions(8, model))

    delta = profile.quantiles("deltaNorm")
    assert delta is not None and delta[50] == pytest.approx(0.2, abs=0.01)
    assert profile.quantiles("missRate")[50] == 0.0
    assert profile.quantiles("strayRate")[50] == 0.0
    assert profile.quantiles("goodMs")[50] == 60.0
    assert profile.quantiles("sessionDeltaStd")[50] < 0.01
    assert profile.n_notes == 8 * 80


def test_miss_rate_distribution_reflects_the_missed_share():
    chart = make_chart(50, "rock")
    model = PlayerModel(
        **PRECISE, cluster=(chart[0].time_ms, chart[0].time_ms + 10 * 400.0), cluster_p_miss=1.0
    )
    sessions = []
    for i in range(6):
        request = simulate(chart, model, good_ms=60.0, seed=i).request
        request["playId"] = f"m{i}"
        sessions.extend(read_sessions(ListSource(view_rows(request))))

    profile = build_profile(GROUP_DRUM, sessions)

    assert profile.quantiles("missRate")[50] == pytest.approx(0.2)


def test_hand_ratio_is_measured_for_sticks_and_absent_for_keyboard():
    weak = PlayerModel(**PRECISE, weak_stick=0, weak_ratio=0.6, velocity_sd=1.0)
    drums = build_profile(GROUP_DRUM, _sessions(6, weak, n_notes=100))
    keyboard_model = PlayerModel(**PRECISE, keyboard=True)
    keys = build_profile(
        GROUP_KEYBOARD, _sessions(6, keyboard_model, n_notes=100, input_source="KEYBOARD")
    )

    assert drums.quantiles("handRatio")[50] == pytest.approx(0.6, abs=0.03)
    assert keys.quantiles("handRatio") is None


def test_drum_and_keyboard_groups_are_profiled_separately():
    filtered = FilterResult(
        drum=_sessions(5, PlayerModel(**PRECISE)),
        keyboard=_sessions(5, PlayerModel(**PRECISE, keyboard=True), input_source="KEYBOARD"),
    )

    profiles = build_profiles(filtered)

    assert profiles[GROUP_DRUM].n_sessions == 5 and profiles[GROUP_KEYBOARD].n_sessions == 5
    assert profiles[GROUP_KEYBOARD].group == GROUP_KEYBOARD


def test_record_hides_flag_counts_between_one_and_four():
    sessions = _sessions(50, PlayerModel(**PRECISE))
    late = _sessions(MIN_CELL - 1, PlayerModel(mean=0.6, sigma=0.2, p_miss=0.0, p_stray=0.0))
    record = build_profile(GROUP_DRUM, sessions + late).to_record()

    timing = record["flagRates"]["TIMING_LATE"]
    assert timing["sessions"] is None and timing["rate"] is None and timing["ci"] is None
    assert timing["upperBound"] == pytest.approx((MIN_CELL - 1) / record["nSessions"], abs=1e-4)
    zero = record["flagRates"]["HAND_WEAK"]
    assert zero["sessions"] == 0 and zero["upperBound"] is None


def test_record_shows_exact_values_from_five_flags_up():
    sessions = _sessions(20, PlayerModel(**PRECISE))
    late = _sessions(MIN_CELL, PlayerModel(mean=0.6, sigma=0.2, p_miss=0.0, p_stray=0.0))

    timing = build_profile(GROUP_DRUM, sessions + late).to_record()["flagRates"]["TIMING_LATE"]

    assert timing["sessions"] == MIN_CELL
    assert timing["rate"] == pytest.approx(MIN_CELL / 25, abs=1e-4)


def test_record_masks_distributions_with_fewer_than_five_sessions():
    few = build_profile(GROUP_DRUM, _sessions(MIN_CELL - 1, PlayerModel(**PRECISE))).to_record()
    enough = build_profile(GROUP_DRUM, _sessions(MIN_CELL, PlayerModel(**PRECISE))).to_record()

    assert all(d["masked"] and d["nSessions"] is None for d in few["distributions"].values())
    assert not enough["distributions"]["deltaNorm"]["masked"]
    assert "q50" in enough["distributions"]["deltaNorm"]


def test_record_is_json_serializable_and_has_no_session_keys():
    sessions = _sessions(6, PlayerModel(**PRECISE))
    record = build_profile(GROUP_DRUM, sessions).to_record()

    text = json.dumps(record, ensure_ascii=False)

    assert not any(s.session_key in text for s in sessions)


def test_empty_group_is_handled():
    profile = build_profile(GROUP_KEYBOARD, [])

    assert profile.n_sessions == 0 and profile.mean_segments == 0.0
    assert profile.to_record()["anyFlag"]["sessions"] == 0


def test_same_input_gives_same_record():
    sessions = _sessions(6, PlayerModel(mean=0.3, sigma=0.3))

    first = build_profile(GROUP_DRUM, sessions).to_record()
    second = build_profile(GROUP_DRUM, sessions).to_record()

    assert first == second


def test_synthetic_request_helper_is_still_valid_for_profiles():
    sessions = read_sessions(ListSource(view_rows(synthetic_request(1, n_notes=60))))

    assert build_profile(GROUP_DRUM, sessions).n_sessions == 1
