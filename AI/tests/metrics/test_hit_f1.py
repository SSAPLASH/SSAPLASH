"""채보 타격 F1 테스트."""

from __future__ import annotations

import math

import numpy as np
import pytest

from ssaplash_ai.bench.datasets import DROP, make_hits
from ssaplash_ai.bench.metrics import (
    MatchCounts,
    PedalConfusion,
    evaluate_hits,
    f1_from_counts,
    pedal_confusion,
    score_hits,
)

TABLE = {
    "KICK": "KICK",
    "SNARE": "SNARE",
    "HIHAT": "HIHAT",
    "SMALL_TOM": "SMALL_TOM",
    "MID_TOM": "MID_TOM",
    "FLOOR_TOM": "FLOOR_TOM",
    "CRASH": "CRASH",
    "RIDE": "RIDE",
    "HIHAT_PEDAL": "HIHAT_PEDAL",
    "tom": "tom",
    "cymbal": "cymbal",
    "clap": DROP,
}

TIMES = [0.10, 0.35, 0.60, 0.85, 1.10, 1.35, 1.60, 1.85]
PADS_SEQ = ["KICK", "HIHAT", "SNARE", "HIHAT", "SMALL_TOM", "CRASH", "FLOOR_TOM", "RIDE"]
VELS = [100, 60, 110, 62, 90, 120, 95, 70]


def _hits(times, pads, vels=None, coarse=False):
    hits, _ = make_hits(times, pads, vels, TABLE, allow_coarse=coarse)
    return hits


def test_정답을_예측으로_넣으면_전부_1():
    true = _hits(TIMES, PADS_SEQ, VELS)
    ev = evaluate_hits(true, true.copy(), eight_pad=True)
    assert ev.five.f1 == 1.0 and ev.pads.f1 == 1.0 and ev.any.f1 == 1.0
    assert ev.pads.f1_tight == 1.0 and ev.pads.perfect_ratio == 1.0
    assert ev.pads.counts == MatchCounts(tp=8, fp=0, fn=0)
    assert ev.pads.mean_err_ms == 0.0 and ev.pads.mean_abs_err_ms == 0.0
    assert ev.pads.by_label["HIHAT"] == MatchCounts(tp=2, fp=0, fn=0)
    assert ev.five.by_label["tom"] == MatchCounts(tp=2, fp=0, fn=0)
    assert ev.five.by_label["cymbal"] == MatchCounts(tp=2, fp=0, fn=0)


def test_30ms_밀면_50ms는_맞고_25ms는_틀린다():
    true = _hits(TIMES, PADS_SEQ)
    pred = _hits([t + 0.030 for t in TIMES], PADS_SEQ)
    s = score_hits(true, pred, "pads")
    assert s.f1 == 1.0 and s.f1_tight == 0.0 and s.perfect_ratio == 0.0
    assert abs(s.mean_err_ms - 30.0) < 1e-6 and abs(s.mean_abs_err_ms - 30.0) < 1e-6
    # 앞으로 밀면 부호가 음수
    early = score_hits(true, _hits([t - 0.030 for t in TIMES], PADS_SEQ), "pads")
    assert abs(early.mean_err_ms + 30.0) < 1e-6


def test_라벨을_틀리면_라벨_기준은_떨어지고_라벨_무시는_1():
    true = _hits(TIMES, PADS_SEQ)
    wrong = [p if p != "SNARE" else "KICK" for p in PADS_SEQ]
    ev = evaluate_hits(true, _hits(TIMES, wrong), eight_pad=True)
    assert ev.any.f1 == 1.0
    # 스네어 1개가 킥으로: 킥 fp 1, 스네어 fn 1 → tp 7, fp 1, fn 1
    assert ev.pads.counts == MatchCounts(tp=7, fp=1, fn=1)
    assert ev.five.counts == MatchCounts(tp=7, fp=1, fn=1)
    assert ev.pads.by_label["KICK"] == MatchCounts(tp=1, fp=1, fn=0)
    assert ev.pads.by_label["SNARE"] == MatchCounts(tp=0, fp=0, fn=1)
    assert ev.pads.f1 == pytest.approx(7 / 8)


def test_탐_종류만_틀리면_5가지는_맞고_8패드는_틀린다():
    true = _hits(TIMES, PADS_SEQ)
    swapped = [{"SMALL_TOM": "MID_TOM", "CRASH": "RIDE"}.get(p, p) for p in PADS_SEQ]
    ev = evaluate_hits(true, _hits(TIMES, swapped), eight_pad=True)
    assert ev.five.f1 == 1.0
    assert ev.pads.counts == MatchCounts(tp=6, fp=2, fn=2)


def test_거친_라벨_예측은_5가지만_매기고_8패드는_없다():
    true = _hits(TIMES, PADS_SEQ)
    coarse = [
        {"SMALL_TOM": "tom", "FLOOR_TOM": "tom", "CRASH": "cymbal", "RIDE": "cymbal"}.get(p, p)
        for p in PADS_SEQ
    ]
    pred = _hits(TIMES, coarse, coarse=True)
    ev = evaluate_hits(true, pred, eight_pad=False)
    assert ev.pads is None and ev.five.f1 == 1.0
    # eight_pad를 참이라고 해도 거친 라벨이 있으면 8패드는 계산하지 않음
    assert evaluate_hits(true, pred, eight_pad=True).pads is None
    with pytest.raises(ValueError, match="거친 라벨"):
        score_hits(true, pred, "pads")


def test_합산_F1은_곡별_F1_평균과_다르다():
    # 곡 A: 타격 1개, 맞힘 (F1 1.0). 곡 B: 타격 9개 중 3개만 맞힘 (F1 0.5)
    a_true = _hits([0.1], ["KICK"])
    b_true = _hits([0.1 * i for i in range(1, 10)], ["SNARE"] * 9)
    b_pred = _hits([0.1, 0.2, 0.3], ["SNARE"] * 3)
    sa = score_hits(a_true, a_true, "pads")
    sb = score_hits(b_true, b_pred, "pads")
    mean_f1 = (sa.f1 + sb.f1) / 2
    total = sa.counts + sb.counts
    assert total == MatchCounts(tp=4, fp=0, fn=6)
    assert f1_from_counts(total.tp, total.fp, total.fn) == pytest.approx(0.5714, abs=1e-3)
    assert mean_f1 == pytest.approx(0.75)


def test_빈_표_규칙():
    empty = _hits([], [])
    true = _hits(TIMES, PADS_SEQ)
    assert score_hits(empty, empty, "pads").f1 == 1.0
    s = score_hits(true, empty, "pads")
    assert s.f1 == 0.0 and math.isnan(s.perfect_ratio) and math.isnan(s.mean_err_ms)
    assert score_hits(empty, true, "pads").counts == MatchCounts(tp=0, fp=8, fn=0)


def test_세기_상관은_양쪽에_세기가_있고_쌍이_충분할_때만():
    times = [0.1 * i for i in range(1, 13)]
    pads = ["KICK"] * 12
    vels_true = list(range(40, 124, 7))
    true = _hits(times, pads, vels_true)
    assert score_hits(
        true, _hits(times, pads, [v + 5 for v in vels_true]), "pads"
    ).velocity_corr == (pytest.approx(1.0))
    assert math.isnan(score_hits(true, _hits(times, pads), "pads").velocity_corr)  # 예측 세기 없음
    few = _hits(times[:5], pads[:5], vels_true[:5])
    assert math.isnan(score_hits(few, few, "pads").velocity_corr)  # 쌍 10개 미만


def test_예측_하나는_정답_하나와만_짝짓는다():
    # 정답 2개가 모두 창 안에 있어도 예측 1개는 한 번만 짝지어짐 (1:1, mir_eval 최대 매칭)
    true = _hits([1.00, 1.04], ["KICK", "KICK"])
    pred = _hits([1.03], ["KICK"])
    s = score_hits(true, pred, "pads")
    assert s.counts == MatchCounts(tp=1, fp=0, fn=1)
    assert abs(s.mean_err_ms) <= 30.0 + 1e-6


def test_dtype이_다르면_오류():
    with pytest.raises(ValueError, match="dtype"):
        score_hits(np.zeros(1), np.zeros(1), "pads")


def test_페달은_8패드_점수에서_하이햇에_합치고_9패드에서는_따로():
    true = _hits([0.1, 0.5, 0.9], ["HIHAT_PEDAL", "HIHAT", "KICK"])
    # 모델이 페달 소리를 HIHAT으로 냄
    pred = _hits([0.1, 0.5, 0.9], ["HIHAT", "HIHAT", "KICK"])
    ev = evaluate_hits(true, pred, eight_pad=True)
    assert ev.pads.f1 == 1.0 and ev.five.f1 == 1.0
    assert "HIHAT_PEDAL" not in ev.pads.by_label
    assert ev.pads9.by_label["HIHAT_PEDAL"] == MatchCounts(tp=0, fp=0, fn=1)
    assert ev.pads9.by_label["HIHAT"] == MatchCounts(tp=1, fp=1, fn=0)
    assert ev.pedal == PedalConfusion(pedal_as_hihat=1, hihat_as_pedal=0)


def test_페달_혼동_수는_정답_하이햇을_페달로_낸_것도_센다():
    true = _hits([0.1, 0.5, 0.9], ["HIHAT_PEDAL", "HIHAT", "HIHAT"])
    pred = _hits([0.1, 0.5, 0.9], ["HIHAT_PEDAL", "HIHAT_PEDAL", "HIHAT"])
    c = pedal_confusion(true, pred)
    assert c == PedalConfusion(pedal_as_hihat=0, hihat_as_pedal=1)
    assert c + c == PedalConfusion(0, 2)
    s9 = score_hits(true, pred, "pads9")
    assert s9.by_label["HIHAT_PEDAL"] == MatchCounts(tp=1, fp=1, fn=0)


def test_거친_라벨이_있으면_9패드_점수는_없다():
    true = _hits([0.1], ["HIHAT_PEDAL"])
    pred = _hits([0.1], ["tom"], coarse=True)
    ev = evaluate_hits(true, pred, eight_pad=True)
    assert ev.pads is None and ev.pads9 is None and ev.pedal is None
