"""합성 연주 모델: 만든 요청이 BE 형식 계약을 지키고 같은 시드면 같은 결과인지."""

from __future__ import annotations

import statistics

import pytest

from ssaplash_ai.coach import AnalysisRequest
from ssaplash_ai.coach_eval.chart import LAYOUT_NAMES, make_chart
from ssaplash_ai.coach_eval.player import PERFECT_MS, PlayerModel, simulate

GOOD_MS_VALUES = (30.0, 50.0, 60.0, 100.0, 150.0)


def _rows(play):
    return play.request["hits"]


def _note_times(play):
    return {n.note_id: n.time_ms for n in play.chart}


@pytest.mark.parametrize("layout", LAYOUT_NAMES)
@pytest.mark.parametrize("good_ms", GOOD_MS_VALUES)
def test_request_passes_be_schema(layout, good_ms):
    """어떤 배치·판정 폭에서도 요청이 `AnalysisRequest` 검증을 통과한다."""
    play = simulate(make_chart(120, layout), PlayerModel(sigma=0.4, p_stray=0.1), good_ms, seed=1)
    request = AnalysisRequest.model_validate(play.request)
    assert request.timingWindows.goodMs == good_ms


def test_random_layout_is_seeded_and_has_no_fixed_predecessor():
    a = make_chart(300, "random", seed=1)
    assert a == make_chart(300, "random", seed=1)
    assert a != make_chart(300, "random", seed=2)
    # 스네어 앞에 오는 패드가 하나로 정해져 있지 않다
    before_snare = {a[i - 1].pad for i in range(1, len(a)) if a[i].pad == "SNARE"}
    assert len(before_snare) >= 4


def test_seq_is_contiguous_and_sorted_by_time():
    rows = _rows(simulate(make_chart(100), PlayerModel(p_stray=0.2, sigma=0.5), seed=3))
    assert [r["seq"] for r in rows] == list(range(len(rows)))
    times = [r["tMs"] for r in rows]
    assert times == sorted(times)


def test_delta_equals_hit_time_minus_note_time_and_stays_in_window():
    """`deltaMs`는 타격 시각 − 노트 시각(늦음 +)이고 PERFECT/GOOD은 판정 폭 안이다."""
    play = simulate(make_chart(200), PlayerModel(mean=0.2, sigma=0.3), good_ms=50.0, seed=4)
    times = _note_times(play)
    judged = [r for r in _rows(play) if r["judgement"] in ("PERFECT", "GOOD")]
    assert judged
    for r in judged:
        assert r["tMs"] - times[r["matchedNoteId"]] == pytest.approx(r["deltaMs"], abs=0.002)
        assert abs(r["deltaMs"]) <= 50.0
        assert (r["judgement"] == "PERFECT") == (abs(r["deltaMs"]) <= PERFECT_MS)


def test_miss_rows_follow_be_format():
    play = simulate(make_chart(200), PlayerModel(p_miss=0.3), seed=5)
    times = _note_times(play)
    misses = [r for r in _rows(play) if r["judgement"] == "MISS"]
    assert misses
    for r in misses:
        assert r["tMs"] == times[r["matchedNoteId"]]
        for key in ("stickId", "velocity", "peakAccel", "deltaMs", "baselinePad", "predictedPad"):
            assert r[key] is None


def test_stray_rows_follow_be_format():
    play = simulate(make_chart(200), PlayerModel(p_stray=0.5), seed=6)
    strays = [r for r in _rows(play) if r["judgement"] is None]
    assert strays
    for r in strays:
        assert r["matchedNoteId"] is None and r["deltaMs"] is None
        assert r["velocity"] is not None


def test_each_note_appears_exactly_once_as_judged_or_miss():
    play = simulate(make_chart(150), PlayerModel(sigma=0.6, p_miss=0.1, p_stray=0.1), seed=7)
    ids = [r["matchedNoteId"] for r in _rows(play) if r["judgement"] is not None]
    assert sorted(ids) == sorted(n.note_id for n in play.chart)


def test_same_seed_same_output_and_other_seed_differs():
    chart = make_chart(100)
    a = simulate(chart, PlayerModel(), seed=11).request
    b = simulate(chart, PlayerModel(), seed=11).request
    c = simulate(chart, PlayerModel(), seed=12).request
    assert a == b
    assert a != c


def test_hit_outside_window_becomes_miss_plus_stray():
    """판정 폭을 한참 벗어난 연주는 노트 MISS와 여분의 타격으로 기록된다."""
    play = simulate(make_chart(40), PlayerModel(mean=3.0, sigma=0.05, p_miss=0, p_stray=0), seed=8)
    kinds = [r["judgement"] for r in _rows(play)]
    assert kinds.count("MISS") == 40
    assert kinds.count(None) == 40
    assert "PERFECT" not in kinds and "GOOD" not in kinds


def test_weak_stick_has_lower_velocity():
    play = simulate(
        make_chart(300), PlayerModel(weak_stick=0, weak_ratio=0.6, velocity_sd=3.0), seed=9
    )
    by_stick = {0: [], 1: []}
    for r in _rows(play):
        if r["judgement"] in ("PERFECT", "GOOD"):
            by_stick[r["stickId"]].append(r["velocity"])
    assert statistics.mean(by_stick[0]) < 0.7 * statistics.mean(by_stick[1])


def test_keyboard_play_has_no_stick_info():
    play = simulate(make_chart(60), PlayerModel(keyboard=True), seed=10)
    for r in _rows(play):
        assert r["stickId"] is None and r["peakAccel"] is None


def test_pad_shift_affects_only_that_pad():
    play = simulate(
        make_chart(400, "mixed"),
        PlayerModel(pad_shift={"SNARE": 0.5}, sigma=0.05, p_miss=0, p_stray=0),
        seed=13,
    )
    deltas: dict[str, list[float]] = {}
    pads = {n.note_id: n.pad for n in play.chart}
    for r in _rows(play):
        if r["judgement"] in ("PERFECT", "GOOD"):
            deltas.setdefault(pads[r["matchedNoteId"]], []).append(r["deltaMs"])
    assert statistics.mean(deltas["SNARE"]) == pytest.approx(25.0, abs=2.0)
    assert abs(statistics.mean(deltas["KICK"])) < 3.0


def test_transition_shift_affects_only_notes_after_that_transition():
    play = simulate(
        make_chart(400, "mixed"),
        PlayerModel(
            transition=("HIHAT", "SNARE"),
            transition_shift=0.5,
            sigma=0.05,
            p_miss=0,
            p_stray=0,
        ),
        seed=14,
    )
    pads = [n.pad for n in play.chart]
    after = {n.note_id: (pads[i - 1] if i else None) for i, n in enumerate(play.chart)}
    on_transition, other_snare = [], []
    for r in _rows(play):
        if r["judgement"] not in ("PERFECT", "GOOD") or r["pad"] != "SNARE":
            continue
        (on_transition if after[r["matchedNoteId"]] == "HIHAT" else other_snare).append(
            r["deltaMs"]
        )
    assert statistics.mean(on_transition) == pytest.approx(25.0, abs=2.0)
    assert abs(statistics.mean(other_snare)) < 3.0


def test_cluster_misses_only_inside_range():
    chart = make_chart(200)
    start, end = chart[80].time_ms, chart[100].time_ms
    play = simulate(
        chart, PlayerModel(p_miss=0, p_stray=0, cluster=(start, end), cluster_p_miss=1.0), seed=15
    )
    miss_times = [r["tMs"] for r in _rows(play) if r["judgement"] == "MISS"]
    assert len(miss_times) == 20
    assert all(start <= t < end for t in miss_times)
