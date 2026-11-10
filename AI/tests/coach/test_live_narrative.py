"""연주 중 LLM 구간 코칭의 사실·프롬프트·가드레일(설계 COACH-001 연주 중 LLM 코칭 3.2, 3.5)."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from ssaplash_ai.coach.live_narrative import (
    MAX_SUB,
    MAX_TITLE,
    LiveSegmentFacts,
    LiveTip,
    build_user_prompt,
    check,
    parse_tip,
    write_live_tip,
)


def facts(**over) -> LiveSegmentFacts:
    base = {
        "contractVersion": 1,
        "segment": {"index": 1, "fromBar": 5, "toBar": 8},
        "input": "stick",
        "counts": {"perfect": 10, "good": 8, "miss": 6},
        "timing": {"meanDeltaMs": 28.4, "stdDeltaMs": 18.0, "sameSignRatio": 0.8},
        "pads": [{"pad": "SNARE", "notes": 8, "misses": 3, "meanDeltaMs": 35.0}],
        "hands": {"weakHand": None, "ratio": None},
        "ruleCoach": {"tags": ["LIVE_LATE"], "causes": ["DRIFT_LATE"]},
        "previous": {"counts": {"perfect": 12, "good": 8, "miss": 2}, "lastTip": None},
        "stage": 2,
    }
    base.update(over)
    return LiveSegmentFacts.model_validate(base)


def tip(title: str, sub: str = "") -> LiveTip:
    return LiveTip(title=title, sub=sub)


def test_facts_ignore_unknown_fields_and_reject_bad_values() -> None:
    f = LiveSegmentFacts.model_validate({**facts().model_dump(), "playId": "x", "userId": 3})
    assert not hasattr(f, "playId")
    with pytest.raises(ValidationError):
        facts(input="mouse")
    with pytest.raises(ValidationError):
        facts(pads=[{"pad": "SNARE", "notes": 1, "misses": 0}] * 4)


def test_prompt_turns_numbers_into_words_and_names_kit_pads() -> None:
    p = build_user_prompt(
        facts(pads=[{"pad": "SMALL_TOM", "notes": 4, "misses": 2, "meanDeltaMs": 20}])
    )
    assert "탐1" in p and "스몰탐" not in p
    assert "박보다 늦음" in p
    assert "28.4" not in p and "35" not in p
    assert "점점 늦어지다 놓침" in p
    assert "직전 구간보다 놓침이 늘었음" in p


def test_prompt_mentions_last_tip_and_hint() -> None:
    f = facts(previous={"lastTip": {"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"}})
    p = build_user_prompt(f, hint="제목이 8자를 넘음")
    assert "반복 금지" in p and "스틱을 낮게" in p
    assert "제목이 8자를 넘음" in p


@pytest.mark.parametrize(
    "raw",
    [
        '{"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"}',
        '```json\n{"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"}\n```',
        '좋아요. {"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"} <end_of_turn>',
    ],
)
def test_parse_tip_reads_the_first_json(raw: str) -> None:
    assert parse_tip(raw) == tip("스틱을 낮게", "높이는 주먹 하나만큼")


@pytest.mark.parametrize(
    "raw", ["스틱을 낮게 하세요", '{"title": 3}', '{"title": "a", "sub": 1}', "{깨짐"]
)
def test_parse_tip_rejects_other_shapes(raw: str) -> None:
    assert parse_tip(raw) is None


def test_good_tip_passes() -> None:
    assert check(tip("스틱을 낮게", "킥 소리에 맞춰 내려요"), facts()) == []
    assert check(tip("스네어 미리!", "앞 노트 칠 때 옮겨요"), facts()) == []


@pytest.mark.parametrize(
    ("t", "expected"),
    [
        (tip("스틱을 아주 많이 낮게 들어요"), f"제목이 {MAX_TITLE}자를 넘음"),
        (tip("스틱을 낮게", "높이는 주먹 하나 정도면 충분해요"), f"보조가 {MAX_SUB}자를 넘음"),
        (tip("스틱을 낮게", "주먹 1개 높이"), "숫자를 씀"),
        (tip("점수 올려요"), "금지어를 씀"),
        (tip("Lower stick"), "영어·외국 글자를 씀"),
        (tip("# 낮게"), "마크다운·기호를 씀"),
        (tip("", "높이를 낮춰요"), "제목이 비었음"),
    ],
)
def test_guardrail_rejects(t: LiveTip, expected: str) -> None:
    assert expected in check(t, facts())


def test_keyboard_rejects_stick_words() -> None:
    kb = facts(input="keyboard")
    assert "키보드인데 스틱 표현을 씀" in check(tip("손목 힘 빼요"), kb)
    assert check(tip("손가락 대기", "키 위에 올려 둬요"), kb) == []


def test_pads_must_come_from_facts_except_the_kick_anchor() -> None:
    f = facts()  # 사실의 패드는 스네어뿐
    assert any("사실에 없는 패드" in p for p in check(tip("탐1 미리!"), f))
    assert check(tip("킥에 맞춰요", "킥 소리에 손을 맞춰요"), f) == []
    # '하이햇 페달'을 '하이햇'으로, '플로어탐'을 '탐'으로 잘못 세지 않는다
    pedal = facts(pads=[{"pad": "HIHAT_PEDAL", "notes": 4, "misses": 2}])
    assert check(tip("하이햇 페달!"), pedal) == []


def test_repeating_the_last_tip_is_rejected() -> None:
    f = facts(previous={"lastTip": {"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"}})
    assert "직전 문구를 반복함" in check(tip("스틱을 낮게", "다르게 말해요"), f)
    assert "직전 문구를 반복함" in check(tip("낮게 들어요", "높이는 주먹 하나만큼"), f)


def test_write_retries_with_the_problem_and_returns_the_first_passing_tip() -> None:
    prompts: list[str] = []
    answers = iter(
        [
            json.dumps({"title": "스틱을 아주 많이 낮게 들어요", "sub": ""}, ensure_ascii=False),
            json.dumps({"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"}, ensure_ascii=False),
        ]
    )

    def gen(system: str, user: str) -> str:
        prompts.append(user)
        return next(answers)

    out = write_live_tip(facts(), gen)
    assert out.tip == tip("스틱을 낮게", "높이는 주먹 하나만큼")
    assert out.attempts == 2
    assert "제목이 8자를 넘음" in prompts[1]


def test_write_gives_up_after_two_bad_answers_or_a_generator_error() -> None:
    out = write_live_tip(facts(), lambda s, u: "그냥 글")
    assert out.tip is None and out.attempts == 2 and out.violations == ["JSON 모양이 아님"]

    def boom(system: str, user: str) -> str:
        raise TimeoutError

    out = write_live_tip(facts(), boom)
    assert out.tip is None and out.attempts == 1 and "생성기 오류" in out.violations[0]
