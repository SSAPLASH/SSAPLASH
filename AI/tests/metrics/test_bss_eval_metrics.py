"""BSS 지표 테스트. 합성 신호만 사용, 2초 클립."""

from __future__ import annotations

import numpy as np
import pytest

from helpers import SR
from ssaplash_ai.bench.metrics import bss_metrics, si_sdr


def _signals(seconds: float = 2.0):
    rng = np.random.default_rng(0)
    n = int(seconds * SR)
    drums = (0.3 * rng.standard_normal((2, n))).astype(np.float32)
    t = np.arange(n) / SR
    accomp = np.stack([0.3 * np.sin(2 * np.pi * 110 * t), 0.3 * np.sin(2 * np.pi * 165 * t)])
    return drums, accomp.astype(np.float32)


def test_정답을_예측으로_넣으면_sdr이_매우_크다():
    drums, accomp = _signals()
    r = bss_metrics(drums, accomp, drums, accomp, SR)
    assert r.sdr_drums > 100 and r.sdr_accomp > 100
    assert r.si_sdr_drums == float("inf") and r.si_sdr_accomp == float("inf")
    assert r.sir_accomp > 50 and r.sar_accomp > 50


def test_무음을_예측으로_넣으면_sdr이_매우_작다():
    drums, accomp = _signals()
    mixture = drums + accomp
    r = bss_metrics(drums, accomp, np.zeros_like(drums), mixture, SR)
    assert r.sdr_drums == float("-inf") and r.sir_drums == float("-inf")
    assert r.si_sdr_drums == float("-inf")
    # 무음이 아닌 반주 쪽은 그대로 계산됨
    assert np.isfinite(r.sdr_accomp)
    # 반주 예측 = 원곡이면 드럼이 통째로 새어 들어가므로 반주 SIR이 낮음
    assert r.sir_accomp < 10


def test_원곡을_드럼_예측으로_넣으면_반주보다_드럼_sdr이_낮다():
    drums, accomp = _signals()
    mixture = drums + accomp
    r = bss_metrics(drums, accomp, mixture, np.zeros_like(accomp), SR)
    assert np.isfinite(r.sdr_drums)
    assert r.sdr_drums < 10


def test_길이가_다르면_짧은_쪽에_맞춘다():
    drums, accomp = _signals()
    r = bss_metrics(drums, accomp, drums[:, :-1000], accomp[:, :-500], SR)
    assert r.sdr_drums > 100


@pytest.mark.parametrize("scale", [0.5, 2.0])
def test_si_sdr은_배율에_무관하다(scale: float):
    drums, _ = _signals(0.5)
    assert si_sdr(drums, scale * drums) == float("inf")


def test_si_sdr_잡음을_섞으면_유한한_값이다():
    drums, accomp = _signals(0.5)
    v = si_sdr(drums, drums + 0.1 * accomp)
    assert np.isfinite(v)
    assert 10 < v < 30
