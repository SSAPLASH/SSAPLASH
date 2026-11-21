"""후보 선택 규칙과 분석 진입점(reason 결정, 결정성)."""

from __future__ import annotations

from coach_helpers import N, build_request, patterns_of, run, same
from ssaplash_ai.coach import ANALYZER_VERSION
from ssaplash_ai.coach.patterns import Candidate
from ssaplash_ai.coach.select import select_candidates


def _cand(pattern: str, from_ms: float, severity: float, pads: tuple[str, ...] = ("SNARE",)):
    return Candidate(
        pattern=pattern,
        from_ms=from_ms,
        to_ms=from_ms + 1000,
        description="",
        cause_tags=[],
        pads=list(pads),
        severity=severity,
    )


def test_심한_순서로_최대_5개를_고르고_시간_순으로_돌려준다():
    candidates = [
        _cand("TIMING_LATE", 700, 0.1),
        _cand("PAD_LATE", 600, 0.2),
        _cand("HAND_WEAK", 500, 0.9),
        _cand("UNSTEADY", 400, 0.8),
        _cand("MISS_CLUSTER", 300, 0.7),
        _cand("TRANSITION_MISS", 200, 0.6),
        _cand("TRANSITION_LATE", 100, 0.5),
    ]

    chosen = select_candidates(candidates)

    assert [c.pattern for c in chosen] == [
        "TRANSITION_LATE",  # 심한 순 상위 5개를 뽑은 뒤 fromMs 오름차순
        "TRANSITION_MISS",
        "MISS_CLUSTER",
        "UNSTEADY",
        "HAND_WEAK",
    ]


def test_같은_pattern은_2개까지만_고른다():
    candidates = [
        _cand("TRANSITION_LATE", 100, 0.9, ("HIHAT", "SNARE")),
        _cand("TRANSITION_LATE", 200, 0.8, ("SNARE", "KICK")),
        _cand("TRANSITION_LATE", 300, 0.7, ("KICK", "RIDE")),
        _cand("UNSTEADY", 400, 0.1),
    ]

    chosen = select_candidates(candidates)

    assert [c.pattern for c in chosen].count("TRANSITION_LATE") == 2
    assert [c.from_ms for c in chosen if c.pattern == "TRANSITION_LATE"] == [100, 200]
    assert "UNSTEADY" in [c.pattern for c in chosen]


def test_같은_구간_같은_패드_후보는_심한_것_하나만_남긴다():
    candidates = [_cand("PAD_LATE", 100, 0.3), _cand("PAD_LATE", 100, 0.6)]

    chosen = select_candidates(candidates)

    assert len(chosen) == 1
    assert chosen[0].severity == 0.6


def test_후보가_없으면_빈_목록이다():
    assert select_candidates([]) == []


def test_노트가_8개_미만이면_INSUFFICIENT_HITS다():
    response = run(same(7, delta=40))

    assert response["reason"] == "INSUFFICIENT_HITS"
    assert response["weakSegments"] == []
    assert response["analyzerVersion"] == ANALYZER_VERSION


def test_타격_기록이_비어_있어도_INSUFFICIENT_HITS다():
    assert run([])["reason"] == "INSUFFICIENT_HITS"


def test_여분의_타격은_표본_수에_포함되지_않는다():
    strays = tuple((1100.0 + i * 500, "HIHAT", 70) for i in range(10))
    notes = same(7, delta=40)

    from ssaplash_ai.coach import AnalysisRequest, analyze

    request = AnalysisRequest.model_validate(build_request(notes, strays=strays))

    assert analyze(request).reason == "INSUFFICIENT_HITS"


def test_노트가_정확히_20개면_분석한다():
    response = run(same(20, delta=40))

    assert response["reason"] == "OK"


def test_약점이_없으면_NO_WEAKNESS이고_빈_배열이다():
    response = run(same(30, delta=2))

    assert response["reason"] == "NO_WEAKNESS"
    assert response["weakSegments"] == []


def test_같은_입력은_항상_같은_출력이다():
    notes = [N(pad="HIHAT" if i % 2 == 0 else "SNARE", delta=30 if i % 2 else 0) for i in range(24)]

    first = run(notes)

    assert all(run(notes) == first for _ in range(3))


def test_결과_구간은_fromMs_오름차순이고_5개를_넘지_않는다():
    # 여러 약점이 한꺼번에 있는 연주: 늦음 + 전환 지연 + 놓침 몰림
    notes = [N(pad="HIHAT" if i % 2 == 0 else "SNARE", delta=35 if i % 2 else 5) for i in range(40)]
    for i in (10, 11, 12, 13):
        notes[i] = N(pad=notes[i].pad, delta=None)

    segments = run(notes)["weakSegments"]

    assert 1 <= len(segments) <= 5
    assert [s["fromMs"] for s in segments] == sorted(s["fromMs"] for s in segments)
    assert patterns_of({"weakSegments": segments}).count("MISS_CLUSTER") <= 2
