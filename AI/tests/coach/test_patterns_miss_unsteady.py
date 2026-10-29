"""MISS_CLUSTER(놓침 몰림)와 UNSTEADY(박자 불안정) 패턴."""

from __future__ import annotations

from coach_helpers import N, find, patterns_of, run, same


def _song_with_misses(count: int, missed: set[int]) -> list[N]:
    return [N(delta=None) if i in missed else N(delta=0) for i in range(count)]


def test_놓침이_몰린_구간은_가장_센_창_하나로_보고한다():
    # 노트 30개(0.5초 간격, 0초 시작). 5.0~6.5초에 연속 4개를 놓침.
    # 40% 이상인 5초 창이 2~6초, 3~8초, 4~9초, 5~10초 시작 4개 → 동률이라 가운데(3~8초) 창을 쓴다.
    response = run(_song_with_misses(30, {10, 11, 12, 13}), t0=0.0)

    assert patterns_of(response) == ["MISS_CLUSTER"]
    segment = response["weakSegments"][0]
    assert (segment["fromMs"], segment["toMs"]) == (3000.0, 8000.0)
    assert segment["description"] == "3~8초 구간에서 노트의 40%를 놓쳤어요."
    assert segment["pads"] == ["SNARE"]
    assert segment["metrics"] == {
        "severity": 0.67,
        "missRate": 0.4,
        "missCount": 4,
        "noteCount": 10,
        "scope": "SEGMENT",
    }


def test_놓침이_고르게_퍼져_있으면_MISS_CLUSTER가_나오지_않는다():
    response = run(_song_with_misses(30, {3, 8, 13, 18, 23, 28}), t0=0.0)  # 5초 창마다 2개(20%)

    assert patterns_of(response) == []
    assert response["reason"] == "NO_WEAKNESS"


def test_멀리_떨어진_두_구간은_각각_보고하고_시간_순으로_정렬한다():
    missed = {5, 6, 7, 8, 45, 46, 47, 48}
    response = run(_song_with_misses(60, missed), t0=0.0)

    clusters = find(response, "MISS_CLUSTER")

    assert len(clusters) == 2
    assert clusters[0]["fromMs"] < clusters[1]["fromMs"]


def test_창_안_노트가_4개_미만이면_놓침_비율이_높아도_걸리지_않는다():
    # 노트 간격 2초 → 5초 창에 노트 2~3개
    response = run(_song_with_misses(24, {10, 11}), t0=0.0, step_ms=2000.0)

    assert "MISS_CLUSTER" not in patterns_of(response)


def test_오차가_40ms씩_크게_흔들리면_UNSTEADY가_나온다():
    notes = [N(delta=40 if i % 2 == 0 else -40) for i in range(30)]

    response = run(notes)

    assert patterns_of(response) == ["UNSTEADY"]
    segment = response["weakSegments"][0]
    assert segment["description"] == "박자가 들쭉날쭉해요(편차 40ms)."
    assert segment["causeTags"] == ["UNSTEADY", "OVERALL"]
    assert segment["metrics"]["severity"] == 1.0
    assert segment["metrics"]["stdDeltaMs"] == 40.0


def test_UNSTEADY_기준은_goodMs의_절반이다():
    steady = [N(delta=24 if i % 2 == 0 else -24) for i in range(30)]  # 편차 24ms < 25ms
    wobbly = [N(delta=26 if i % 2 == 0 else -26) for i in range(30)]  # 편차 26ms ≥ 25ms

    assert patterns_of(run(steady)) == []
    assert patterns_of(run(wobbly)) == ["UNSTEADY"]


def test_UNSTEADY_기준도_goodMs에_비례한다():
    notes = [N(delta=40 if i % 2 == 0 else -40) for i in range(30)]

    assert patterns_of(run(notes, good_ms=100)) == []  # 기준 50ms
    assert patterns_of(run(notes, good_ms=50)) == ["UNSTEADY"]


def test_전부_PERFECT인_정확한_연주는_약점이_없다():
    response = run(same(40, delta=3))

    assert response["reason"] == "NO_WEAKNESS"
    assert response["weakSegments"] == []
