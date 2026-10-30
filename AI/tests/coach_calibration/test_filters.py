"""이상치 제외: 진짜 플레이가 아닌 것만 빼고, 서툰 플레이는 남긴다."""

from __future__ import annotations

from calibration_helpers import synthetic_request, view_rows
from ssaplash_ai.coach_calibration.filters import (
    CORRUPT,
    EXCLUDE_REASONS,
    IDLE,
    TOO_FEW_NOTES,
    TOO_LARGE,
    UNSUPPORTED_MODE,
    FilterConfig,
    exclusion_reason,
    filter_sessions,
)
from ssaplash_ai.coach_calibration.source import ListSource, Session, read_sessions
from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.player import PlayerModel, simulate


def _session(request=None, **view_kwargs) -> Session:
    rows = view_rows(request or synthetic_request(1, n_notes=60), **view_kwargs)
    (session,) = read_sessions(ListSource(rows))
    return session


def _idle_session(n_notes: int, missed: int) -> Session:
    """앞에서부터 `missed`개 노트를 놓친 연주. 나머지는 정확히 친다."""
    chart = make_chart(n_notes, "rock")
    model = PlayerModel(
        sigma=0.02,
        p_miss=0.0,
        p_stray=0.0,
        cluster=(chart[0].time_ms, chart[0].time_ms + missed * 400.0) if missed else None,
        cluster_p_miss=1.0,
    )
    request = simulate(chart, model, good_ms=50.0, seed=1).request
    return _session(request)


def test_clean_drum_session_is_kept():
    assert exclusion_reason(_session()) is None


def test_keyboard_session_is_kept_but_separately_from_drums():
    result = filter_sessions(
        [
            _session(synthetic_request(1), input_source="STICK"),
            _session(synthetic_request(2), input_source="KEYBOARD"),
        ]
    )

    assert len(result.drum) == 1 and len(result.keyboard) == 1
    assert result.keyboard[0].input_source == "KEYBOARD"
    assert not result.excluded


def test_session_with_fewer_than_20_notes_is_excluded():
    short = _session(synthetic_request(1, n_notes=19))
    enough = _session(synthetic_request(1, n_notes=20))

    assert exclusion_reason(short) == TOO_FEW_NOTES
    assert exclusion_reason(enough) is None


def test_idle_boundary_is_exactly_ninety_percent_missed():
    assert exclusion_reason(_idle_session(100, 89)) is None
    assert exclusion_reason(_idle_session(100, 90)) == IDLE
    assert exclusion_reason(_idle_session(100, 100)) == IDLE


def test_poorly_played_sessions_are_not_excluded():
    """서툰 연주(오차가 크고 절반을 놓침)는 진짜 플레이이므로 남긴다."""
    clumsy = synthetic_request(3, n_notes=120, model=PlayerModel(sigma=0.6, p_miss=0.5))

    assert exclusion_reason(_session(clumsy)) is None


def test_more_than_50000_hits_is_excluded_without_validating_each_row():
    session = _session()
    session.hits = [dict(session.hits[0], seq=i) for i in range(50_001)]

    assert exclusion_reason(session) == TOO_LARGE
    assert exclusion_reason(session, FilterConfig(max_hits=60_000)) != TOO_LARGE


def test_unsupported_mode_is_excluded():
    session = _session()
    session.mode = "FREE"

    assert exclusion_reason(session) == UNSUPPORTED_MODE


def test_corrupt_sessions_are_excluded():
    inconsistent = _session()
    inconsistent.inconsistent = True

    duplicate_seq = _session()
    duplicate_seq.hits[5]["seq"] = duplicate_seq.hits[4]["seq"]

    time_goes_back = _session()
    time_goes_back.hits[10]["t_ms"] = time_goes_back.hits[3]["t_ms"] - 1.0

    missing_window = _session()
    missing_window.good_ms = None

    unknown_input = _session()
    unknown_input.input_source = "MIDI"

    judged_without_delta = _session()
    first_judged = next(
        h for h in judged_without_delta.hits if h["judgement"] in ("PERFECT", "GOOD")
    )
    first_judged["delta_ms"] = None

    for bad in (
        inconsistent,
        duplicate_seq,
        time_goes_back,
        missing_window,
        unknown_input,
        judged_without_delta,
    ):
        assert exclusion_reason(bad) == CORRUPT


def test_counts_account_for_every_session_by_reason():
    sessions = [
        _session(synthetic_request(1)),
        _session(synthetic_request(2), input_source="KEYBOARD"),
        _session(synthetic_request(3, n_notes=10)),
        _idle_session(100, 95),
        _idle_session(100, 100),
    ]

    result = filter_sessions(sessions)
    counts = result.counts()

    assert counts["TOTAL"] == 5
    assert counts["KEPT_DRUM"] == 1 and counts["KEPT_KEYBOARD"] == 1
    assert counts[TOO_FEW_NOTES] == 1 and counts[IDLE] == 2
    assert result.kept + sum(result.excluded.values()) == result.total
    assert set(EXCLUDE_REASONS) <= set(counts)  # 0건인 이유도 항상 나온다


def test_result_never_carries_session_keys_or_values():
    secret_key = "SECRET-SESSION-KEY"
    result = filter_sessions([_session(synthetic_request(1, n_notes=10), session_key=secret_key)])

    assert secret_key not in repr(result) and secret_key not in str(result.counts())


def test_same_input_gives_same_result():
    sessions = [_session(synthetic_request(s)) for s in range(5)]

    first, second = filter_sessions(sessions), filter_sessions(sessions)

    assert first.counts() == second.counts()
    assert [s.session_key for s in first.drum] == [s.session_key for s in second.drum]
