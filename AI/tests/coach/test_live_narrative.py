"""연주 중 LLM 구간 코칭의 사실·프롬프트·가드레일(설계 COACH-001 연주 중 LLM 코칭 3.2, 3.5)."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from ssaplash_ai.coach.live_narrative import (
    MAX_SUB,
    MAX_TITLE,
    SYSTEM_PROMPT,
    TIP_EXAMPLES,
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
    assert "스몰탐" in p and "탐1" not in p
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
    # 항목은 '규칙 이름' 또는 '규칙 이름: 자세히'다
    assert expected in [p.split(":")[0] for p in check(t, facts())]


def test_keyboard_rejects_stick_words() -> None:
    kb = facts(input="keyboard")
    assert "키보드인데 스틱 표현을 씀" in check(tip("손목 힘 빼요"), kb)
    assert check(tip("손가락 대기", "키 위에 올려 둬요"), kb) == []


def test_pads_must_come_from_facts_except_the_kick_anchor() -> None:
    f = facts()  # 사실의 패드는 스네어뿐
    assert any("사실에 없는 패드" in p for p in check(tip("스몰탐 미리!"), f))
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
    # 두 번째 시도에는 실제 글자 수와 앞선 답을 보여 준다
    assert (
        f"지금 {len('스틱을 아주 많이 낮게 들어요')}자" in prompts[1]
        and "스틱을 아주 많이 낮게 들어요" in prompts[1]
    )


def test_write_gives_up_after_two_bad_answers_or_a_generator_error() -> None:
    out = write_live_tip(facts(), lambda s, u: "그냥 글")
    assert out.tip is None and out.attempts == 2 and out.violations == ["JSON 모양이 아님"]

    def boom(system: str, user: str) -> str:
        raise TimeoutError

    out = write_live_tip(facts(), boom)
    assert out.tip is None and out.attempts == 1 and "생성기 오류" in out.violations[0]


AIM_LOW = {"pad": "SMALL_TOM", "hits": 6, "wrongPad": 3, "vertical": "LOW", "size": "CLEAR"}


def _example_facts(situation: str) -> LiveSegmentFacts:
    """프롬프트 예시 상황에 맞는 사실"""
    late = {"meanDeltaMs": 30.0, "stdDeltaMs": 12.0, "sameSignRatio": 0.85}
    if situation.startswith("키보드"):
        return facts(input="keyboard", timing=late, pads=[])
    if "늦음" in situation:
        return facts(timing=late, pads=[])
    if "빠름" in situation:
        return facts(timing={"meanDeltaMs": -30.0}, pads=[])
    if "스틱 끝" in situation:
        return facts(timing={}, pads=[], aim=[AIM_LOW])
    if "약한 손" in situation:
        return facts(timing={}, pads=[], hands={"weakHand": "LEFT", "ratio": 0.6})
    return facts(timing={}, pads=[], previous={})


@pytest.mark.parametrize(("situation", "title", "sub"), TIP_EXAMPLES)
def test_every_prompt_example_passes_its_own_guardrail(
    situation: str, title: str, sub: str
) -> None:
    assert check(tip(title, sub), _example_facts(situation)) == []
    assert f'"title": "{title}", "sub": "{sub}"' in SYSTEM_PROMPT


def test_pad_names_follow_the_kit_labels() -> None:
    f = facts(pads=[{"pad": "SMALL_TOM", "notes": 8, "misses": 4}])
    assert check(tip("스몰탐 미리!", "스몰탐으로 옮길 때 봐요"), f) == []
    assert "숫자를 씀" in check(tip("스몰탐 미리!", "두 박 전에 3번 봐요"), f)
    # 화면에 없는 옛 이름은 쓰지 않는다(숫자로 걸린다)
    assert "숫자를 씀" in check(tip("탐1 미리!"), f)


def test_length_violation_tells_the_actual_length() -> None:
    sub = "손목을 살짝 뒤로 젖혀서 스틱을 누르세요"
    out = check(tip("손목", sub), facts())
    assert (
        f"보조가 {MAX_SUB}자를 넘음: 지금 공백 포함 {len(sub)}자, {MAX_SUB}자 이하로 줄이세요"
        in out
    )


def test_stick_input_must_not_press() -> None:
    assert "스틱인데 누른다고 함" in check(tip("일찍 눌러요"), facts())
    assert "스틱인데 누른다고 함" not in check(tip("일찍 눌러요"), facts(input="keyboard"))


def test_posture_needs_evidence_from_aim_or_hands() -> None:
    no_evidence = facts(pads=[{"pad": "SMALL_TOM", "notes": 8, "misses": 4}])
    assert "근거 없이 자세를 말함" in check(tip("손목 풀기", "손목을 살짝 젖혀요"), no_evidence)
    assert "근거 없이 자세를 말함" in check(tip("끝 들기", "스몰탐은 스틱 끝을 높게"), no_evidence)
    with_aim = facts(pads=[], aim=[AIM_LOW])
    assert check(tip("끝 들기", "스몰탐은 스틱 끝을 높게"), with_aim) == []
    weak = facts(hands={"weakHand": "LEFT", "ratio": 0.6})
    assert "근거 없이 자세를 말함" not in check(tip("왼손목 풀기"), weak)
    # 자세를 말하지 않는 지시는 근거가 없어도 된다
    assert check(tip("앞당겨요", "박보다 살짝 일찍 쳐요"), facts()) == []


@pytest.mark.parametrize(
    ("f", "t", "expected"),
    [
        (facts(), tip("천천히", "박을 기다렸다 쳐요"), "늦은 구간에 더 늦추라고 함"),
        (facts(timing={"meanDeltaMs": -30.0}), tip("서둘러요"), "빠른 구간에 더 서두르라고 함"),
        (
            facts(pads=[], aim=[AIM_LOW]),
            tip("끝 내리기", "스몰탐은 스틱 끝을 낮게"),
            "스틱 끝이 낮은데 더 낮추라고 함",
        ),
        (
            facts(pads=[], aim=[{**AIM_LOW, "vertical": None, "horizontal": "LEFT"}]),
            tip("왼쪽으로", "스몰탐은 끝을 왼쪽으로"),
            "스틱 끝이 왼쪽인데 더 왼쪽으로 하라고 함",
        ),
    ],
)
def test_direction_contradictions_are_rejected(
    f: LiveSegmentFacts, t: LiveTip, expected: str
) -> None:
    assert expected in check(t, f)


def test_opposite_aims_do_not_block_either_direction() -> None:
    high = {**AIM_LOW, "pad": "SNARE", "vertical": "HIGH"}
    f = facts(pads=[], aim=[AIM_LOW, high])
    assert check(tip("끝 들기", "스몰탐은 스틱 끝을 높게"), f) == []


def test_aim_is_optional_and_described_in_words() -> None:
    assert facts().aim == []
    f = facts(aim=[{**AIM_LOW, "horizontal": "LEFT", "hand": "RIGHT"}])
    p = build_user_prompt(f)
    assert "스틱 끝 방향: 스몰탐 칠 때 기준보다 낮고 왼쪽(많이 벗어남)" in p
    assert "다른 패드로 잡힌 타격 있음" in p and "주로 오른손" in p
    only_low = build_user_prompt(facts(aim=[{**AIM_LOW, "size": "SLIGHT"}]))
    assert "기준보다 낮음(조금 벗어남)" in only_low
    # 키보드에는 스틱 끝 방향을 말하지 않는다
    assert "스틱 끝 방향" not in build_user_prompt(facts(input="keyboard", aim=[AIM_LOW]))
    with pytest.raises(ValidationError):
        facts(aim=[{**AIM_LOW, "vertical": "UP"}])
