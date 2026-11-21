"""짧은 곡(노트 8~19개): 전체 타이밍과 한쪽 손만 더 엄격한 기준으로 본다."""

from __future__ import annotations

from coach_helpers import N, build_request, same
from ssaplash_ai.coach import AnalysisRequest, analyze

SHORT_PATTERNS = {"TIMING_LATE", "TIMING_EARLY", "HAND_WEAK"}


def _run(notes, **kwargs):
    request = build_request(notes, good_ms=60.0, **kwargs)
    return analyze(AnalysisRequest.model_validate(request))


def _patterns(response) -> list[str]:
    return [s.pattern for s in response.weakSegments]


def _hands(count: int, weak: int, strong: int = 90) -> list[N]:
    """양손을 번갈아 치고 왼손(0)만 약하다."""
    return [
        N(delta=3.0, stick=i % 2, velocity=weak if i % 2 == 0 else strong) for i in range(count)
    ]


def _mixed(count: int) -> list[N]:
    """3개 중 2개는 40ms 늦고 1개는 20ms 빠르다: 평균 20ms 늦음, 같은 방향 67%."""
    return [N(delta=-20.0) if i % 3 == 2 else N(delta=40.0) for i in range(count)]


def test_노트가_8개면_분석하고_총평이_온다():
    response = _run(same(8, delta=40.0))

    assert response.reason == "OK"
    assert _patterns(response) == ["TIMING_LATE"]
    assert response.summary is not None
    assert response.summary.focusPattern == "TIMING_LATE"


def test_짧은_곡에서_빠르게_치면_TIMING_EARLY다():
    assert _patterns(_run(same(12, delta=-40.0))) == ["TIMING_EARLY"]


def test_짧은_곡에서는_놓침_몰림과_패드_패턴을_보지_않는다():
    # 앞 8개를 모두 놓쳤다. 20개 이상이면 MISS_CLUSTER가 잡히는 모양이다
    notes = [N(delta=None) for _ in range(8)] + [N(pad="KICK", delta=3.0) for _ in range(8)]

    response = _run(notes)

    assert response.reason == "NO_WEAKNESS"
    assert response.weakSegments == []
    assert response.summary.level == "NEEDS_WORK"


def test_짧은_곡의_약점은_전체_타이밍과_한쪽_손뿐이다():
    notes = [N(delta=45.0, stick=i % 2, velocity=40 if i % 2 == 0 else 100) for i in range(14)]

    patterns = _patterns(_run(notes))

    assert patterns and set(patterns) <= SHORT_PATTERNS


def test_짧은_곡은_같은_방향_비율을_더_엄격하게_본다():
    assert _patterns(_run(_mixed(12))) == []
    assert "TIMING_LATE" in _patterns(_run(_mixed(24)))


def test_짧은_곡은_평균이_표준오차보다_충분히_커야_잡는다():
    # 평균 18.8ms 늦고 80%가 같은 방향이지만 세 타격이 끌어올린 평균이라 표준오차의 2.5배에 못 미친다
    notes = [N(delta=58.0)] * 3 + [N(delta=6.0)] * 5 + [N(delta=-8.0)] * 2

    assert _patterns(_run(notes)) == []


def test_짧은_곡에서_한쪽_손이_뚜렷하게_약하면_HAND_WEAK다():
    assert _patterns(_run(_hands(12, weak=50))) == ["HAND_WEAK"]


def test_짧은_곡은_손_세기_차이를_더_엄격하게_본다():
    # 비율 0.72: 20개 이상에서는 잡히고(0.75 미만) 짧은 곡에서는 잡히지 않는다(0.70 이상)
    assert _patterns(_run(_hands(12, weak=65))) == []
    assert _patterns(_run(_hands(40, weak=65))) == ["HAND_WEAK"]


def test_짧은_곡은_양손_타격이_5개씩_있어야_손_세기를_본다():
    assert _patterns(_run(_hands(8, weak=40))) == []
    assert _patterns(_run(_hands(10, weak=40))) == ["HAND_WEAK"]


def test_노트_20개_이상은_짧은_곡_기준을_쓰지_않는다():
    # 같은 방향 67%는 짧은 곡 기준(75%)에 못 미치지만 20개 이상에서는 잡힌다
    assert "TIMING_LATE" in _patterns(_run(_mixed(21)))
