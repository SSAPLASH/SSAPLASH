"""온셋 보존율 테스트. 합성 타격음만 사용."""

from __future__ import annotations

import numpy as np

from helpers import HITS, SR, make_hits
from ssaplash_ai.bench.datasets import SongItem
from ssaplash_ai.bench.metrics import detect_onsets, merge_onsets, onset_metrics, onset_scores
from ssaplash_ai.bench.runner.benchmark_runner import true_onsets


def test_검출기가_타격_위치를_찾는다():
    onsets = detect_onsets(make_hits(), SR)
    assert len(onsets) == len(HITS)
    assert np.all(np.abs(onsets - np.array(HITS)) < 0.03)


def test_정답_스템을_예측으로_넣으면_f1이_1이다():
    drums = make_hits()
    onsets_true = detect_onsets(drums, SR)
    r = onset_metrics(onsets_true, drums, SR)
    assert r.f1 == 1.0 and r.precision == 1.0 and r.recall == 1.0
    assert r.f1_tight == 1.0
    assert r.n_true == r.n_pred == len(HITS)


def test_50ms_밀린_신호는_25ms_기준에서_0에_가깝다():
    drums = make_hits()
    onsets_true = detect_onsets(drums, SR)
    shifted = np.roll(drums, int(0.05 * SR), axis=1)
    r = onset_metrics(onsets_true, shifted, SR)
    assert r.f1_tight < 0.01
    # 50ms 허용 오차에서는 대부분 맞는다 (검출 프레임 11.6ms 오차 허용)
    assert r.f1 > 0.6


def test_무음_예측은_재현율이_0이다():
    drums = make_hits()
    onsets_true = detect_onsets(drums, SR)
    r = onset_metrics(onsets_true, np.zeros_like(drums), SR)
    assert r.f1 == 0.0 and r.recall == 0.0 and r.n_pred == 0


def test_onset_scores_빈_배열_규칙():
    assert onset_scores(np.array([]), np.array([])) == (0.0, 0.0, 0.0)
    assert onset_scores(np.array([0.1]), np.array([])) == (0.0, 0.0, 0.0)
    assert onset_scores(np.array([0.1]), np.array([0.12])) == (1.0, 1.0, 1.0)


def test_30ms_안에_붙은_정답_시각은_첫_시각만_남는다():
    times = np.array([0.5, 0.0, 0.01, 0.02, 0.1, 0.131])
    assert merge_onsets(times).tolist() == [0.0, 0.1, 0.131, 0.5]
    assert merge_onsets(np.array([])).size == 0


def test_동시_타격이_두_줄인_정답도_합치면_재현율이_1이다():
    # 킥·하이햇을 같은 순간 친 주석처럼 정답 시각마다 한 줄씩 더 있음
    drums = make_hits()
    doubled = np.repeat(np.array(HITS, dtype=np.float64), 2)
    assert onset_metrics(doubled, drums, SR).recall == 0.5
    r = onset_metrics(merge_onsets(doubled), drums, SR)
    assert r.recall == 1.0 and r.n_true == len(HITS)


def test_러너는_주석_정답을_합치고_검출_정답은_그대로_둔다():
    drums = make_hits()
    zeros = np.zeros_like(drums)
    annotated = SongItem(
        "d", "s", SR, drums, drums, zeros, onsets_true=np.array([0.5, 0.5, 0.51, 1.0])
    )
    assert true_onsets(annotated).tolist() == [0.5, 1.0]
    detected = SongItem("d", "s", SR, drums, drums, zeros)
    assert true_onsets(detected).tolist() == detect_onsets(drums, SR).tolist()
