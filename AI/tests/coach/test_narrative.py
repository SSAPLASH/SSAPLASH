"""LLM 총평의 사실→프롬프트. 모델 없이 가짜 생성기로 본다."""

from __future__ import annotations

from ssaplash_ai.coach.narrative import (
    SYSTEM_PROMPT,
    NarrativeFacts,
    build_user_prompt,
)

GOOD_TEXT = (
    "전체적으로 기본기는 잘 잡혀 있어요. 킥은 특히 안정적으로 쳤어요. "
    "7~12초 구간에서 노트 10개 중 4개를 놓쳤으니 그 부분만 느린 템포로 반복해 보세요."
)


def _facts(**overrides) -> NarrativeFacts:
    data = {
        "level": "FAIR",
        "focusPattern": "MISS_CLUSTER",
        "counts": {"perfect": 20, "good": 10, "miss": 10},
        "strengthPad": "KICK",
        "segments": [
            {
                "pattern": "MISS_CLUSTER",
                "severityLevel": "MEDIUM",
                "pads": ["SNARE"],
                "fromMs": 7000.0,
                "toMs": 12000.0,
                "scope": "SEGMENT",
                "metrics": {"severity": 0.67, "missRate": 0.4, "missCount": 4, "noteCount": 10},
            }
        ],
        "history": None,
    }
    data.update(overrides)
    return NarrativeFacts.model_validate(data)


def _history(miss: int, perfect: int = 20, good: int = 10, plays: int = 3) -> dict:
    return {
        "sameSongPlays": plays,
        "previous": {
            "counts": {"perfect": perfect, "good": good, "miss": miss},
            "topPatterns": ["TIMING_LATE"],
        },
    }


# ---------- 프롬프트 ----------


def test_프롬프트에는_사실만_있고_식별_정보는_없다():
    raw = {
        "level": "FAIR",
        "counts": {"perfect": 1, "good": 1, "miss": 1},
        "playId": "6f1c2d3e-0a1b-4c5d-8e9f-001122334455",
        "userId": 42,
        "hits": [{"tMs": 1}],
    }
    facts = NarrativeFacts.model_validate(raw)
    prompt = build_user_prompt(facts)

    assert "playId" not in facts.model_dump()
    assert "6f1c2d3e" not in prompt and "42" not in prompt and "hits" not in prompt


def test_프롬프트는_약점과_판정과_지난_연주를_담는다():
    prompt = build_user_prompt(_facts(history=_history(miss=18)))

    assert "특정 구간에서 놓침이 몰림" in prompt
    assert "7~12초 구간" in prompt and "스네어" in prompt
    assert "완벽 20개, 좋음 10개, 놓침 10개" in prompt
    assert "지난 연주" in prompt and "비교하지 마세요" not in prompt


def test_이력이_없으면_비교하지_말라고_알린다():
    assert "비교하지 마세요" in build_user_prompt(_facts())


def test_시스템_프롬프트는_규칙을_담는다():
    for needle in ("사실에 없는", "점수와 정확도", "400자", "총평 문장만"):
        assert needle in SYSTEM_PROMPT
