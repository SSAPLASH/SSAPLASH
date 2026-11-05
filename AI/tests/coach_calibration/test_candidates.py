"""후보 생성과 what-if: 선택 규칙(순수 함수)과, 단계적으로 약점이 센 합성 집단에서의 동작."""

from __future__ import annotations

import dataclasses
import json

import pytest

from calibration_helpers import view_rows
from ssaplash_ai.coach.config import DEFAULT_THRESHOLDS, ENABLED_PATTERNS, Thresholds
from ssaplash_ai.coach_calibration.candidates import (
    CHANGE,
    GROUPS,
    INSUFFICIENT_SAMPLE,
    KEEP,
    KNOBS,
    NO_TARGET,
    OK,
    OUT_OF_REACH,
    WhatIf,
    build_report,
    choose_candidate,
    reevaluate,
)
from ssaplash_ai.coach_calibration.policy import Policy
from ssaplash_ai.coach_calibration.profile import FlagRate
from ssaplash_ai.coach_calibration.source import ListSource, Session, read_sessions
from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.player import PlayerModel, simulate
from ssaplash_ai.coach_eval.runner import RunConfig

PRECISE = {"sigma": 0.05, "p_miss": 0.0, "p_stray": 0.0}


def _point(multiplier: float, rate: float, current: float = 0.3) -> WhatIf:
    n = 1000
    return WhatIf(multiplier, round(current * multiplier, 3), FlagRate("X", round(rate * n), n))


def _cohort(models: list[PlayerModel], n_notes: int = 80) -> list[Session]:
    sessions: list[Session] = []
    for i, model in enumerate(models):
        chart = make_chart(n_notes, "rock", seed=i)
        request = simulate(chart, model, good_ms=60.0, seed=i).request
        request["playId"] = f"c{i:03d}"
        sessions.extend(read_sessions(ListSource(view_rows(request))))
    return sessions


def _late_gradient(count: int = 60) -> list[Session]:
    """평균 지연이 0.1~0.5 × goodMs로 고르게 퍼진 집단. 임계값을 올리면 걸림이 부드럽게 줄어든다."""
    return _cohort([PlayerModel(mean=0.1 + 0.4 * i / (count - 1), **PRECISE) for i in range(count)])


# --- 구조 ---


def test_every_enabled_pattern_belongs_to_exactly_one_knob_and_fields_exist():
    covered = [p for k in KNOBS for p in k.patterns]

    assert sorted(covered) == sorted(ENABLED_PATTERNS)
    assert all(hasattr(DEFAULT_THRESHOLDS, k.field) for k in KNOBS)
    assert len({k.field for k in KNOBS}) == len(KNOBS)
    assert GROUPS == {k.group for k in KNOBS}


# --- 선택 규칙(순수 함수) ---


def test_keep_when_current_rate_is_already_inside_the_target():
    points = [_point(1.0, 0.3), _point(1.1, 0.25)]

    choice = choose_candidate(0.3, points, (0.2, 0.4), max_change=0.25)

    assert choice.status == KEEP and choice.chosen is None


def test_change_picks_the_value_closest_to_the_current_one_inside_the_target():
    points = [
        _point(1.0, 0.50),
        _point(1.05, 0.45),
        _point(1.10, 0.40),
        _point(1.15, 0.34),
        _point(1.20, 0.30),
        _point(1.25, 0.20),
    ]

    choice = choose_candidate(0.50, points, (0.2, 0.35), max_change=0.25)

    assert choice.status == CHANGE
    assert choice.chosen.multiplier == 1.15


def test_change_never_goes_beyond_the_allowed_change():
    points = [_point(1.0, 0.5), _point(1.1, 0.4), _point(1.2, 0.3), _point(1.3, 0.2)]

    choice = choose_candidate(0.5, points, (0.15, 0.25), max_change=0.25)

    assert choice.status == OUT_OF_REACH and choice.chosen is None
    assert choice.nearest.multiplier == 1.2  # 허용 폭 안에서 목표에 가장 가까운 점(참고용)


def test_range_boundary_counts_as_inside():
    choice = choose_candidate(0.6, [_point(1.0, 0.6)], (0.4, 0.6), max_change=0.25)

    assert choice.status == KEEP


def test_equal_change_in_both_directions_prefers_the_rate_nearer_the_target_center():
    # 현재 0.7이라 범위(0.4~0.6) 밖. 0.9배와 1.1배는 변경 폭이 같고 둘 다 범위 안이다.
    # 목표 중심은 0.5이므로 0.52(1.1배)가 0.58(0.9배)보다 가깝다.
    points = [_point(0.9, 0.58), _point(1.0, 0.7), _point(1.1, 0.52)]

    choice = choose_candidate(0.7, points, (0.4, 0.6), max_change=0.25)

    assert choice.status == CHANGE and choice.chosen.multiplier == 1.1


def test_target_above_current_is_also_reachable_in_the_other_direction():
    points = [_point(0.75, 0.40), _point(0.85, 0.30), _point(1.0, 0.1)]

    choice = choose_candidate(0.1, points, (0.25, 0.35), max_change=0.25)

    assert choice.status == CHANGE and choice.chosen.multiplier == 0.85


# --- 보고서 ---


def test_too_few_sessions_gives_no_candidates_and_no_what_if():
    report = build_report(_late_gradient(49), Policy(targets={"TIMING": (0.3, 0.4)}))

    assert report.status == INSUFFICIENT_SAMPLE
    assert report.groups == [] and report.thresholds is None


def test_without_targets_only_the_what_if_table_is_produced():
    report = build_report(_late_gradient(), Policy())

    assert report.status == OK
    assert all(g.status == NO_TARGET and g.candidate is None for g in report.groups)
    assert all(len(g.what_if) > 5 for g in report.groups)
    assert report.thresholds is None and report.changed() == {}


def test_what_if_rates_move_in_the_expected_direction():
    report = build_report(_late_gradient(), Policy())
    timing = next(g for g in report.groups if g.group == "TIMING")
    rates = [w.rate.rate for w in timing.what_if]

    assert rates == sorted(rates, reverse=True)  # 임계값을 올릴수록 걸림은 줄어든다
    assert rates[0] > rates[-1]


def test_hand_weak_what_if_rises_with_the_threshold():
    models = [
        PlayerModel(weak_stick=0, weak_ratio=0.55 + 0.4 * i / 59, velocity_sd=2.0, **PRECISE)
        for i in range(60)
    ]
    report = build_report(_cohort(models, n_notes=100), Policy())
    hand = next(g for g in report.groups if g.group == "HAND_WEAK")
    rates = [w.rate.rate for w in hand.what_if]

    assert rates == sorted(rates)  # 기준 비율을 올릴수록 더 많이 걸린다
    assert rates[-1] > rates[0]


def test_change_candidate_lowers_the_flag_rate_into_the_target_within_the_allowed_change():
    sessions = _late_gradient()
    policy = Policy(targets={"TIMING": (0.30, 0.40)})

    report = build_report(sessions, policy)
    timing = next(g for g in report.groups if g.group == "TIMING")

    assert timing.current.rate == pytest.approx(0.5, abs=0.05)
    assert timing.status == CHANGE
    assert timing.current_value < timing.candidate.value <= timing.current_value * 1.25 + 1e-9
    assert 0.30 <= timing.candidate.rate.rate <= 0.40
    assert report.thresholds.timing_mean_ratio == timing.candidate.value
    # 다른 임계값은 그대로다
    others = {f.name for f in dataclasses.fields(Thresholds)} - {"timing_mean_ratio"}
    assert all(getattr(report.thresholds, n) == getattr(DEFAULT_THRESHOLDS, n) for n in others)


def test_keep_and_out_of_reach_do_not_produce_thresholds():
    sessions = _late_gradient()

    keep = build_report(sessions, Policy(targets={"TIMING": (0.4, 0.6)}))
    far = build_report(sessions, Policy(targets={"TIMING": (0.0, 0.05)}))

    assert next(g for g in keep.groups if g.group == "TIMING").status == KEEP
    assert keep.thresholds is None
    unreachable = next(g for g in far.groups if g.group == "TIMING")
    assert unreachable.status == OUT_OF_REACH and unreachable.nearest is not None
    assert far.thresholds is None


def test_record_is_serializable_masks_small_counts_and_has_no_session_keys():
    sessions = _cohort(
        [PlayerModel(**PRECISE)] * 57 + [PlayerModel(mean=0.6, sigma=0.2, p_miss=0, p_stray=0)] * 3
    )
    report = build_report(sessions, Policy(targets={"TIMING": (0.0, 0.2)}))

    record = report.to_record()
    text = json.dumps(record, ensure_ascii=False)

    assert not any(s.session_key in text for s in sessions)
    assert record["groups"]["TIMING"]["current"]["sessions"] is None  # 3건은 가린다
    assert record["groups"]["TIMING"]["current"]["upperBound"] is not None
    assert record["status"] == OK and record["version"].startswith("candidates-")


def test_same_input_gives_same_report():
    sessions = _late_gradient()
    policy = Policy(targets={"TIMING": (0.30, 0.40)})

    assert build_report(sessions, policy).to_record() == build_report(sessions, policy).to_record()


# --- 합성 평가(139 도구)로 재평가 ---


SMALL = RunConfig(seeds=4, note_counts=(60,), good_ms_values=(60.0,))


def test_reevaluation_shows_a_recall_drop_for_a_stricter_candidate():
    stricter = dataclasses.replace(DEFAULT_THRESHOLDS, timing_mean_ratio=0.5)

    result = reevaluate(stricter, SMALL)

    timing_rows = [r for r in result.rows if r.scenario == "TIMING_LATE" and r.strength == 0.4]
    assert timing_rows[0].baseline == 1.0 and timing_rows[0].candidate == 0.0
    assert result.worst_recall_drop() >= 0.9


def test_reevaluation_of_the_current_thresholds_shows_no_change():
    result = reevaluate(DEFAULT_THRESHOLDS, SMALL)

    assert result.worst_recall_drop() == 0.0 and result.worst_fp_rise() == 0.0
    assert json.dumps(result.to_record())
