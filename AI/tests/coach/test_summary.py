"""종합 총평(`summary`): 등급 경계, 문장 규칙, 잘한 점, 약점 없음, 표본 부족, 결정성."""

from __future__ import annotations

import re

from coach_helpers import N, build_request, same
from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach.config import MAX_SUMMARY_CHARS
from ssaplash_ai.coach.notes import build_notes
from ssaplash_ai.coach.summary import build_summary


def _run(notes, **kwargs):
    return analyze(AnalysisRequest.model_validate(build_request(notes, **kwargs)))


def _good_notes(count: int = 40):
    return same(count, delta=3.0)  # 전부 PERFECT, 약점 없음


def test_전부_정확하면_GOOD이고_약점_없음_문장이다():
    response = _run(_good_notes())

    assert response.reason == "NO_WEAKNESS"
    assert response.summary.level == "GOOD"
    assert response.summary.focusPattern is None
    assert response.summary.source == "RULE"
    assert "눈에 띄는 약점은 없었어요" in response.summary.text


def test_표본이_부족하면_총평이_없다():
    response = _run(same(10, delta=3.0))

    assert response.reason == "INSUFFICIENT_HITS"
    assert response.summary is None


def test_총평은_모든_경우에_200자_이하_한국어_완성_문장이다():
    scenarios = [
        _good_notes(),
        same(40, delta=30.0),  # 전체가 늦다
        [N(delta=None) if i % 2 == 0 else N(delta=3.0) for i in range(40)],  # 절반 놓침
    ]
    for notes in scenarios:
        text = _run(notes).summary.text

        assert re.search(r"[가-힣]", text)
        assert text.endswith("요.")
        assert len(text) <= MAX_SUMMARY_CHARS, (len(text), text)
        assert "None" not in text


def test_총평에는_점수와_정확도가_없다():
    for notes in (_good_notes(), same(40, delta=30.0)):
        text = _run(notes).summary.text

        assert not re.search(r"점수|정확도|%", text)


def test_가장_심한_약점이_focusPattern이다():
    response = _run(same(40, delta=40.0))  # 전체가 늦다

    top = max(response.weakSegments, key=lambda s: s.metrics["severity"])
    assert response.summary.focusPattern == top.pattern
    assert "먼저" in response.summary.text and "연습해 보세요" in response.summary.text


def test_HIGH_약점이_있으면_NEEDS_WORK이다():
    response = _run(same(40, delta=55.0))  # 평균 55ms 늦음 → 기준 60ms에서 severity 0.76

    assert any(s.severityLevel == "HIGH" for s in response.weakSegments)
    assert response.summary.level == "NEEDS_WORK"


def test_놓침_비율이_높으면_약점이_없어도_NEEDS_WORK이고_문장이_모순되지_않는다():
    # 약점 탐지와 상관없이 총평 규칙만 본다: 노트 48개 중 18개(37.5%)를 놓쳤고 약점 목록은 비어 있다
    notes = [N(delta=None) if i % 8 < 3 else N(delta=3.0) for i in range(48)]
    table = build_notes(AnalysisRequest.model_validate(build_request(notes)))

    summary = build_summary(table, [])

    assert summary.level == "NEEDS_WORK"
    assert summary.focusPattern is None
    assert "눈에 띄는 약점은 없었어요" not in summary.text
    assert "쉬운 연습 단계" in summary.text


def test_적중률이_높은_패드를_잘한_점으로_꼽는다():
    notes = [N(pad="SNARE", delta=3.0) for _ in range(20)] + [
        N(pad="KICK", delta=3.0) for _ in range(20)
    ]
    text = _run(notes).summary.text

    assert re.search(r"(스네어|킥)(은|는) 특히 안정적으로 쳤어요", text)


def test_노트가_적은_패드는_잘한_점으로_꼽지_않는다():
    notes = [N(pad="SNARE", delta=3.0) for _ in range(34)] + [
        N(pad="KICK", delta=3.0) for _ in range(6)
    ]
    text = _run(notes).summary.text

    assert "킥" not in text


def test_약점으로_지목된_패드는_잘한_점에서_뺀다():
    # 스네어만 늦다 → PAD_LATE의 패드는 스네어. 스네어를 잘했다고 말하면 모순이다
    notes = [N(pad="SNARE", delta=40.0) for _ in range(16)] + [
        N(pad="HIHAT", delta=0.0) for _ in range(24)
    ]
    response = _run(notes)
    weak_pads = {pad for s in response.weakSegments for pad in s.pads}

    for pad_ko, pad in (("스네어", "SNARE"), ("하이햇", "HIHAT")):
        if pad in weak_pads:
            assert f"{pad_ko}은 특히" not in response.summary.text
            assert f"{pad_ko}는 특히" not in response.summary.text


def test_같은_입력은_같은_총평이다():
    request = build_request(same(40, delta=40.0))

    first = analyze(AnalysisRequest.model_validate(request)).summary
    second = analyze(AnalysisRequest.model_validate(request)).summary

    assert first == second


def test_잘한_점_패드가_strengthPad로_나가고_문장과_같다():
    notes = [N(pad="SNARE", delta=3.0) for _ in range(20)] + [
        N(pad="KICK", delta=3.0) for _ in range(20)
    ]
    summary = _run(notes).summary

    assert summary.strengthPad in ("SNARE", "KICK")
    label = {"SNARE": "스네어", "KICK": "킥"}[summary.strengthPad]
    assert label in summary.text


def test_패드마다_노트가_적으면_strengthPad가_없고_칭찬하지_않는다():
    pads = ["SNARE", "KICK", "HIHAT", "CRASH"]
    notes = [N(pad=pads[i % 4], delta=3.0) for i in range(28)]  # 패드당 7개 (기준 8개 미만)
    summary = _run(notes).summary

    assert summary.strengthPad is None
    assert "특히 안정적" not in summary.text


def _segment(pattern: str):
    from ssaplash_ai.coach.schema import WeakSegment

    return WeakSegment(
        fromMs=1000.0,
        toMs=6000.0,
        pattern=pattern,
        description="d",
        causeTags=[],
        pads=["SNARE", "HIHAT"],
        metrics={},
    )


def test_먼저_할_일_문구에서_연습이_두_번_나오지_않는다():
    """리뷰: "먼저 ~치는 연습부터 연습해 보세요."처럼 연습이 겹치면 어색하다."""
    from ssaplash_ai.coach.summary import _focus_phrase

    for pattern in (
        "TIMING_LATE",
        "TIMING_EARLY",
        "PAD_LATE",
        "PAD_EARLY",
        "TRANSITION_LATE",
        "TRANSITION_MISS",
        "HAND_WEAK",
        "MISS_CLUSTER",
        "UNSTEADY",
        "UNKNOWN_PATTERN",
    ):
        phrase = _focus_phrase(_segment(pattern))
        assert "연습" not in phrase, (pattern, phrase)
        sentence = f"먼저 {phrase}부터 연습해 보세요."
        assert sentence.count("연습") == 1


def test_타이밍_손_일정함_약점의_문구는_것으로_끝난다():
    from ssaplash_ai.coach.summary import _focus_phrase

    for pattern in ("TIMING_LATE", "TIMING_EARLY", "HAND_WEAK", "UNSTEADY"):
        assert _focus_phrase(_segment(pattern)).endswith("치는 것")
