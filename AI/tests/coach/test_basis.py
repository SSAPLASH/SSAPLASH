"""임계값의 기준 폭: 기본은 고정 60ms(FE 실시간 코칭과 같음), `basis_ms=None`이면 플레이의 판정 폭(이전 동작)."""

from __future__ import annotations

import pytest

from coach_helpers import LEGACY, N, build_request, patterns_of, run, same
from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach.config import ANALYZER_VERSION, DEFAULT_THRESHOLDS, Thresholds
from ssaplash_ai.coach.notes import build_notes

FIXED = DEFAULT_THRESHOLDS


def test_기본_설정은_고정_60ms를_기준으로_한다():
    assert FIXED.basis_ms == 60.0
    assert LEGACY.basis_ms is None


@pytest.mark.parametrize("good_ms", [30, 50, 60, 100, 150])
def test_기본_설정은_판정_폭이_달라도_같은_오차에_같은_결과다(good_ms):
    """평균 20ms 늦음: 기준 60ms의 30%(18ms)를 넘어서 판정 폭과 무관하게 TIMING_LATE."""
    assert patterns_of(run(same(24, delta=20), thresholds=FIXED, good_ms=good_ms)) == [
        "TIMING_LATE"
    ]
    # 평균 17ms 늦음은 18ms 미만이라 판정 폭이 얼마든 나오지 않는다
    assert patterns_of(run(same(24, delta=17), thresholds=FIXED, good_ms=good_ms)) == []


def test_기준_60ms의_30퍼센트_경계는_포함한다():
    assert patterns_of(run(same(24, delta=17.9), thresholds=FIXED)) == []
    assert patterns_of(run(same(24, delta=18.0), thresholds=FIXED)) == ["TIMING_LATE"]


def test_심각도도_판정_폭에_흔들리지_않는다():
    severity = {
        g: run(same(24, delta=30), thresholds=FIXED, good_ms=g)["weakSegments"][0]["metrics"][
            "severity"
        ]
        for g in (30, 60, 150)
    }
    assert len(set(severity.values())) == 1
    assert severity[60] == 0.42  # min(1, 30 ÷ (1.2 × 60))


def test_이전_동작은_판정_폭에_비례한다():
    # 판정 폭 100이면 기준 30ms라 평균 20ms 늦음은 걸리지 않고, 판정 폭 30이면 기준 9ms라 걸린다
    assert patterns_of(run(same(24, delta=20), thresholds=LEGACY, good_ms=100)) == []
    assert patterns_of(run(same(24, delta=20), thresholds=LEGACY, good_ms=30)) == ["TIMING_LATE"]


def test_들쭉날쭉함도_기준_폭으로_본다():
    wobble = [N(delta=40 if i % 2 == 0 else -40) for i in range(24)]  # 평균 0, 표준편차 40
    # 기본: 표준편차 40 ≥ 0.5 × 60(30) → 판정 폭이 100이어도 UNSTEADY
    assert "UNSTEADY" in patterns_of(run(wobble, thresholds=FIXED, good_ms=100))
    # 이전 동작: 판정 폭 100 → 기준 50이라 걸리지 않는다
    assert "UNSTEADY" not in patterns_of(run(wobble, thresholds=LEGACY, good_ms=100))


def test_기본_분석_응답에_새_분석기_버전이_담긴다():
    request = AnalysisRequest.model_validate(build_request(same(24, delta=20)))
    assert analyze(request).analyzerVersion == ANALYZER_VERSION == "weak-rules-0.5"


def test_기준_폭_선택_메서드():
    table = build_notes(
        AnalysisRequest.model_validate(build_request(same(3, delta=1), good_ms=80.0))
    )
    assert table.good_ms == 80.0
    assert table.basis(FIXED) == 60.0
    assert table.basis(Thresholds(basis_ms=None)) == 80.0
    assert table.basis(Thresholds(basis_ms=45.0)) == 45.0
