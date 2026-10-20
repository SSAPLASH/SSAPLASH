"""온셋 보존율 테스트 (설계 6장 인수 조건 5). 합성 타격음만 사용."""

from __future__ import annotations

import numpy as np

from helpers import SR
from ssaplash_ai.bench.metrics import detect_onsets, onset_metrics, onset_scores

HITS = [0.2, 0.5, 0.9, 1.3, 1.8]


def make_hits(seconds: float = 2.2, times: list[float] | None = None) -> np.ndarray:
    """타격마다 10ms 안에 솟았다가 80ms 동안 꺼지는 잡음 버스트. (2, 샘플)."""
    rng = np.random.default_rng(1)
    n = int(seconds * SR)
    mono = np.zeros(n, dtype=np.float32)
    burst_len = int(0.08 * SR)
    t = np.arange(burst_len) / SR
    env = np.minimum(t / 0.004, 1.0) * np.exp(-t / 0.02)
    for hit in times or HITS:
        start = int(hit * SR)
        burst = env * rng.standard_normal(burst_len)
        mono[start : start + burst_len] += burst.astype(np.float32)
    mono *= 0.5 / np.max(np.abs(mono))
    return np.stack([mono, mono])


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
