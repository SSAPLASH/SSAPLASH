"""성능 목표: 5,000건 1초, 50,000건 3초 이내 (BE 응답 제한 시간 3초)."""

from __future__ import annotations

import time

import pytest

from coach_helpers import N, build_request
from ssaplash_ai.coach import AnalysisRequest, analyze


def _long_play(count: int) -> list[N]:
    """약점이 여러 개 걸리도록 패드를 바꿔 가며 늦게 치고 가끔 놓치는 긴 연주."""
    pads = ["HIHAT", "SNARE", "MID_TOM", "KICK"]
    notes = []
    for i in range(count):
        miss = i % 97 in (10, 11, 12, 13)
        notes.append(N(pad=pads[i % 4], delta=None if miss else 25 + (i % 7) * 3))
    return notes


@pytest.mark.parametrize(("count", "limit_sec"), [(5_000, 1.0), (50_000, 3.0)])
def test_분석이_목표_시간_안에_끝난다(count, limit_sec):
    request = AnalysisRequest.model_validate(build_request(_long_play(count), step_ms=300.0))

    started = time.perf_counter()
    response = analyze(request)
    elapsed = time.perf_counter() - started

    assert response.reason == "OK"
    assert elapsed < limit_sec, f"{count}건 분석에 {elapsed:.2f}초"
