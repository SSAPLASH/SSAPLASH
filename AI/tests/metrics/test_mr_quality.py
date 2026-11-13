"""드럼리스 MR 품질 지표 테스트. 합성 신호만 사용."""

from __future__ import annotations

import math

import numpy as np
import pytest

from ssaplash_ai.bench.metrics import bleed_full, mr_quality

SR = 44100


def _music(seconds: float = 3.0, seed: int = 0) -> np.ndarray:
    """저음 사인 + 넓은 대역 잡음, 스테레오 (2, 샘플)."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    tone = 0.3 * np.sin(2 * np.pi * 220 * t)
    noise = 0.05 * rng.standard_normal(t.size)
    return np.stack([tone + noise, tone + noise]).astype(np.float32)


def _lowpass(x: np.ndarray, cutoff_hz: float) -> np.ndarray:
    spec = np.fft.rfft(x, axis=-1)
    freqs = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    spec[..., freqs > cutoff_hz] = 0
    return np.fft.irfft(spec, n=x.shape[-1], axis=-1).astype(np.float32)


def test_같은_신호면_전부_만점이고_음량_차이가_0이다():
    x = _music()
    q = mr_quality(x, x.copy(), SR)
    assert q.fullness == pytest.approx(100.0)
    assert q.bleedless == pytest.approx(100.0)
    assert q.fullness_high == pytest.approx(100.0)
    assert q.lufs_diff == pytest.approx(0.0, abs=1e-6)
    assert q.clip_ratio == 0.0


def test_고음을_잘라내면_고음_fullness가_전체보다_크게_떨어진다():
    x = _music()
    q = mr_quality(x, _lowpass(x, 4000), SR)
    assert q.fullness_high < q.fullness < 100
    assert q.fullness_high < 30
    assert q.bleedless > 90  # 없는 소리를 더하지는 않음
    assert q.lufs_diff < 0


def test_다른_소리가_섞이면_bleedless가_떨어지고_fullness는_높게_남는다():
    x = _music()
    extra = _music(seed=1) * 2
    q = mr_quality(x, x + extra, SR)
    assert q.bleedless < 90
    assert q.fullness > q.bleedless


def test_1을_넘는_샘플_비율을_센다():
    x = _music(1.0)
    x[0, :441] = 1.2
    assert mr_quality(x, x, SR).clip_ratio == pytest.approx(441 / x.size)


def test_정답이_무음이면_음량_차이는_nan():
    silent = np.zeros((2, SR), dtype=np.float32)
    assert math.isnan(mr_quality(silent, _music(1.0), SR).lufs_diff)


def test_msst_구현과_같은_값을_낸다():
    pytest.importorskip("torch")
    msst_metrics = pytest.importorskip("msst.utils.metrics")
    x = _music()
    y = _lowpass(x, 6000) + 0.02 * _music(seed=2)
    ours = bleed_full(x, y, SR)
    theirs = msst_metrics.bleed_full(x, y, sr=SR)
    assert ours[0] == pytest.approx(float(theirs[0]), rel=1e-3)
    assert ours[1] == pytest.approx(float(theirs[1]), rel=1e-3)
