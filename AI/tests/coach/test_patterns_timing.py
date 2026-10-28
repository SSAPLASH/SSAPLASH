"""TIMING_*(전체 지연)과 PAD_*(패드별 지연) 패턴."""

from __future__ import annotations

import pytest

from coach_helpers import N, find, patterns_of, run, same


def test_전체적으로_늦으면_TIMING_LATE가_나온다():
    response = run(same(24, delta=20))

    assert response["reason"] == "OK"
    assert patterns_of(response) == ["TIMING_LATE"]
    segment = response["weakSegments"][0]
    assert segment["description"] == "전체적으로 평균 20ms 늦게 치고 있어요."
    assert segment["causeTags"] == ["LATE", "OVERALL"]
    assert segment["pads"] == ["SNARE"]
    assert segment["fromMs"] == 1000.0
    assert segment["toMs"] == 12501.0  # 마지막 노트 시각 + 1 (끝 미포함)
    assert segment["metrics"] == {
        "severity": 0.33,
        "meanDeltaMs": 20.0,
        "hitCount": 24,
        "scope": "WHOLE",
    }


def test_전체적으로_빠르면_TIMING_EARLY가_나온다():
    response = run(same(24, delta=-20))

    segment = response["weakSegments"][0]
    assert segment["pattern"] == "TIMING_EARLY"
    assert segment["description"] == "전체적으로 평균 20ms 빠르게 치고 있어요."
    assert segment["causeTags"] == ["EARLY", "OVERALL"]


@pytest.mark.parametrize(
    ("delta", "expected"), [(14.9, []), (15.0, ["TIMING_LATE"]), (15.1, ["TIMING_LATE"])]
)
def test_평균_오차_기준은_goodMs의_30퍼센트이고_경계는_포함한다(delta, expected):
    assert patterns_of(run(same(24, delta=delta))) == expected


@pytest.mark.parametrize(
    ("good_ms", "delta", "expected"),
    [
        (100, 29.0, []),  # 기준 30ms
        (100, 31.0, ["TIMING_LATE"]),
        (30, 8.9, []),  # 기준 9ms
        (30, 9.1, ["TIMING_LATE"]),
    ],
)
def test_임계값은_goodMs에_비례한다(good_ms, delta, expected):
    assert patterns_of(run(same(24, delta=delta), good_ms=good_ms)) == expected


def test_유효_타격이_20개_미만이면_TIMING이_나오지_않는다():
    notes = same(19, delta=20) + [N(delta=None)]  # 노트 20개, 유효 19개

    assert patterns_of(run(notes)) == []
    assert patterns_of(run(same(20, delta=20))) == ["TIMING_LATE"]


def test_같은_부호_비율이_65퍼센트_미만이면_TIMING이_나오지_않는다():
    mixed = same(12, delta=49) + same(8, delta=-5)  # 평균 27.4, 같은 부호 60%

    assert "TIMING_LATE" not in patterns_of(run(mixed))


def test_같은_부호_비율이_정확히_65퍼센트면_TIMING이_나온다():
    mixed = same(13, delta=49) + same(7, delta=-5)  # 평균 30.1, 같은 부호 65%

    assert "TIMING_LATE" in patterns_of(run(mixed))


def test_한_패드만_늦으면_PAD_LATE가_나온다():
    notes = same(12, pad="HIHAT", delta=0) + same(10, pad="SNARE", delta=30)

    response = run(notes)

    assert patterns_of(response) == ["PAD_LATE"]
    segment = response["weakSegments"][0]
    assert segment["description"] == "스네어에서 평균 30ms 늦게 쳐요."
    assert segment["pads"] == ["SNARE"]
    assert segment["metrics"]["meanDeltaMs"] == 30.0
    assert segment["metrics"]["overallMeanDeltaMs"] == 13.6
    assert segment["metrics"]["hitCount"] == 10


def test_한_패드만_빠르면_PAD_EARLY가_나온다():
    notes = same(12, pad="HIHAT", delta=0) + same(10, pad="MID_TOM", delta=-30)

    segment = find(run(notes), "PAD_EARLY")[0]

    assert segment["description"] == "미드탐에서 평균 30ms 빠르게 쳐요."


def test_패드의_유효_타격이_8개_미만이면_PAD가_나오지_않는다():
    notes = same(15, pad="HIHAT", delta=0) + same(7, pad="SNARE", delta=30)

    assert not [p for p in patterns_of(run(notes)) if p.startswith("PAD_")]


def test_전체보다_덜_늦은_패드는_PAD_LATE가_되지_않는다():
    # 전체 평균이 40ms인데 미드탐은 22ms. 평균 20ms 이상이고 차이도 12ms 이상이지만 방향이 반대다.
    notes = same(30, pad="SNARE", delta=45) + same(8, pad="MID_TOM", delta=22)

    response = run(notes)

    assert patterns_of(response) == ["TIMING_LATE"]
