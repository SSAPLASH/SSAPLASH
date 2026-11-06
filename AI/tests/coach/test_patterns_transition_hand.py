"""TRANSITION_*(패드 전환)과 HAND_WEAK(손 세기) 패턴."""

from __future__ import annotations

from coach_helpers import N, find, patterns_of, run, same


def _alternating(count: int, second_delta: float | None, **kwargs) -> list[N]:
    """하이햇(오차 0)과 스네어(오차 `second_delta`)를 번갈아 친다. `None`이면 스네어를 놓친다."""
    return [
        N(pad="HIHAT", delta=0) if i % 2 == 0 else N(pad="SNARE", delta=second_delta, **kwargs)
        for i in range(count)
    ]


def test_전환_노트가_늦으면_TRANSITION_LATE가_나온다():
    response = run(_alternating(24, 30))

    segment = find(response, "TRANSITION_LATE")[0]
    assert segment["description"] == "하이햇에서 스네어로 넘어갈 때 평균 30ms 늦게 쳐요."
    assert segment["pads"] == ["HIHAT", "SNARE"]
    assert segment["causeTags"] == ["LATE", "TRANSITION"]
    assert segment["fromMs"] == 1000.0  # 첫 전환의 앞 노트 시각
    assert segment["toMs"] == 12501.0  # 마지막 전환 노트 시각 + 1
    assert segment["metrics"]["transitionCount"] == 12
    assert segment["metrics"]["hitCount"] == 12


def test_같은_전환이_6번_미만이면_TRANSITION이_나오지_않는다():
    notes = same(10, pad="HIHAT", delta=0) + same(10, pad="SNARE", delta=30)  # 전환 1번

    assert not [p for p in patterns_of(run(notes)) if p.startswith("TRANSITION_")]


def test_전환_노트의_평균_오차가_25ms_미만이면_TRANSITION_LATE가_나오지_않는다():
    assert "TRANSITION_LATE" not in patterns_of(run(_alternating(24, 24)))


def test_전환_노트를_자주_놓치면_TRANSITION_MISS가_나온다():
    notes = _alternating(24, 0)
    for i in (1, 3, 5, 7, 9):  # 스네어 12개 중 5개를 놓침(약 42%)
        notes[i] = N(pad="SNARE", delta=None)

    segment = find(run(notes), "TRANSITION_MISS")[0]

    assert segment["description"] == "하이햇에서 스네어로 넘어갈 때 42%를 놓쳐요."
    assert segment["metrics"]["missCount"] == 5
    assert segment["metrics"]["transitionCount"] == 12
    assert segment["metrics"]["missRate"] == 0.42


def test_놓침_비율이_30퍼센트_미만이면_TRANSITION_MISS가_나오지_않는다():
    notes = _alternating(24, 0)
    for i in (1, 3, 5):  # 12개 중 3개(25%)
        notes[i] = N(pad="SNARE", delta=None)

    assert "TRANSITION_MISS" not in patterns_of(run(notes))


def test_한쪽_손이_약하면_HAND_WEAK가_나온다():
    # 짝수 노트는 스틱 0(세기 100), 홀수 노트는 스틱 1(세기 60)
    notes = [N(velocity=100 if i % 2 == 0 else 60) for i in range(40)]

    response = run(notes)

    assert patterns_of(response) == ["HAND_WEAK"]
    segment = response["weakSegments"][0]
    assert segment["description"] == "오른손이 다른 손보다 40% 약하게 쳐요."
    assert segment["causeTags"] == ["WEAK", "HAND"]
    assert segment["metrics"]["weakStickId"] == 1
    assert segment["metrics"]["velocityRatio"] == 0.6
    assert segment["metrics"]["severity"] == 0.38


def test_두_손_세기_비율이_75퍼센트_이상이면_HAND_WEAK가_나오지_않는다():
    notes = [N(velocity=100 if i % 2 == 0 else 80) for i in range(40)]  # 비율 0.8

    assert patterns_of(run(notes)) == []


def test_스틱_정보가_없는_키보드_입력은_HAND_WEAK가_나오지_않는다():
    notes = [N(velocity=100 if i % 2 == 0 else 60, stick=None) for i in range(40)]

    assert patterns_of(run(notes)) == []


def test_양손_모두_유효_타격이_15개_이상이어야_HAND_WEAK를_판단한다():
    few = [N(velocity=100 if i % 2 == 0 else 60) for i in range(28)]  # 손마다 14개
    enough = [N(velocity=100 if i % 2 == 0 else 60) for i in range(30)]  # 손마다 15개

    assert patterns_of(run(few)) == []
    assert patterns_of(run(enough)) == ["HAND_WEAK"]
