"""자원 측정 테스트. GPU 없이 CPU 경로만."""

from __future__ import annotations

import time

import numpy as np

from ssaplash_ai.bench.metrics import measure_resources


def test_시간과_램을_잰다():
    with measure_resources("cpu", interval_sec=0.01) as usage:
        big = np.ones((2, 5_000_000), dtype=np.float32)
        time.sleep(0.05)
        del big
    assert usage.elapsed_sec >= 0.05
    assert usage.peak_ram_mb > 10
    assert np.isnan(usage.peak_vram_mb)
    assert usage.device == "cpu"


def test_예외가_나도_측정값이_남는다():
    try:
        with measure_resources("cpu") as usage:
            raise RuntimeError("x")
    except RuntimeError:
        pass
    assert usage.elapsed_sec > 0
