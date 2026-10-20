"""어택 기울기 왜곡 테스트. 합성 타격음만 사용."""

from __future__ import annotations

import numpy as np

from helpers import HITS, SR, make_hits
from ssaplash_ai.bench.metrics import attack_slope_distortion
from ssaplash_ai.bench.metrics.attack_slope_distortion import block_peak_envelope


def test_같은_신호면_왜곡이_0이다():
    drums = make_hits()
    r = attack_slope_distortion(drums, drums, np.array(HITS), SR)
    assert r.distortion == 0.0
    assert r.n_used == len(HITS) and r.n_skipped == 0


def test_절반_크기면_왜곡이_ln2이다():
    drums = make_hits()
    r = attack_slope_distortion(drums, 0.5 * drums, np.array(HITS), SR)
    assert abs(r.distortion - np.log(2)) < 1e-6


def test_어택을_뭉개면_왜곡이_커진다():
    drums = make_hits()
    kernel = np.ones(int(0.008 * SR)) / int(0.008 * SR)
    smeared = np.stack([np.convolve(ch, kernel, mode="same") for ch in drums]).astype(np.float32)
    r = attack_slope_distortion(drums, smeared, np.array(HITS), SR)
    assert r.distortion > 0.3


def test_무음_예측은_큰_값이다():
    drums = make_hits()
    r = attack_slope_distortion(drums, np.zeros_like(drums), np.array(HITS), SR)
    assert r.distortion > 5


def test_상승이_없는_온셋은_제외한다():
    drums = make_hits()
    onsets = np.array(HITS + [2.15])  # 2.15초는 무음 구간
    r = attack_slope_distortion(drums, drums, onsets, SR)
    assert r.n_used == len(HITS) and r.n_skipped == 1


def test_온셋이_없으면_nan이다():
    drums = make_hits()
    r = attack_slope_distortion(drums, drums, np.array([]), SR)
    assert np.isnan(r.distortion) and r.n_used == 0


def test_블록_포락선_길이():
    env = block_peak_envelope(np.ones(441, dtype=np.float32), SR, block_ms=1.0)
    assert env.shape == (10,) and np.all(env == 1.0)
