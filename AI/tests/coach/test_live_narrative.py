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
    LiveHabit,
    LiveSegmentFacts,
    LiveTip,
    build_user_prompt,
    check,
    habit_match,
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
        (
            tip("스틱을 낮게", "높이는 주먹 하나 정도면 충분하니까 그만큼만"),
            f"보조가 {MAX_SUB}자를 넘음",
        ),
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
    assert check(tip("킥 전에 눌러", "손가락을 키 위에 둬요"), kb) == []


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
    slightly_late = {"meanDeltaMs": 15.0, "stdDeltaMs": 12.0, "sameSignRatio": 0.85, "goodMs": 60}
    if situation.startswith("키보드"):
        return facts(input="keyboard", timing=slightly_late, pads=[])
    if "늦음" in situation:
        return facts(timing=slightly_late, pads=[])
    if "빠름" in situation:
        return facts(timing={"meanDeltaMs": -30.0, "goodMs": 60}, pads=[])
    if "미드탐을 침" in situation:
        return facts(
            timing={},
            pads=[{"pad": "SMALL_TOM", "notes": 8, "misses": 4, "instead": "MID_TOM"}],
            aim=[{**AIM_LOW, "vertical": None, "horizontal": "RIGHT"}],
        )
    if "스틱 끝" in situation:
        return facts(timing={}, pads=[], aim=[AIM_LOW])
    if "스네어" in situation:
        return facts(timing={}, pads=[{"pad": "SNARE", "notes": 8, "misses": 4}])
    if "하이햇" in situation:
        return facts(timing={}, pads=[{"pad": "HIHAT", "notes": 14, "misses": 5}])
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
    assert "근거 없이 자세를 말함" in check(tip("스몰탐 높게", "스틱 끝을 더 세워요"), no_evidence)
    with_aim = facts(pads=[], aim=[AIM_LOW])
    assert check(tip("스몰탐 높게", "스틱 끝을 더 세워요"), with_aim) == []
    weak = facts(hands={"weakHand": "LEFT", "ratio": 0.6})
    assert "근거 없이 자세를 말함" not in check(tip("왼손목 풀기"), weak)
    # 자세를 말하지 않는 지시는 근거가 없어도 된다
    assert check(tip("앞당겨요", "박보다 살짝 일찍 쳐요"), facts()) == []


@pytest.mark.parametrize(
    ("f", "t", "expected"),
    [
        (facts(), tip("천천히", "박을 기다렸다 쳐요"), "늦은 구간에 더 늦추라고 함"),
        (facts(timing={"meanDeltaMs": -30.0}), tip("서둘러요"), "빠른 구간에 더 서두르라고 함"),
        # 늦은 구간에 기다리라거나 소리를 듣고 치라는 말은 더 늦어지게 한다
        (facts(), tip("킥을 기다려", "킥 소리를 듣고 따라 쳐요"), "늦은 구간에 더 늦추라고 함"),
        (facts(), tip("킥 맞춰요", "킥 소리 들으면 바로 쳐요"), "늦은 구간에 더 늦추라고 함"),
        (
            facts(input="keyboard", pads=[], aim=[]),
            tip("킥에 맞춰", "킥 소리 후에 키를 눌러요"),
            "늦은 구간에 더 늦추라고 함",
        ),
        (
            facts(timing={"meanDeltaMs": -30.0}),
            tip("킥보다 먼저", "킥 소리 전에 내려쳐요"),
            "빠른 구간에 더 서두르라고 함",
        ),
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
    assert check(tip("스몰탐 높게", "스틱 끝을 더 세워요"), f) == []


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


@pytest.mark.parametrize(
    "t",
    [
        tip("조절해요", "박을 중심으로 쳐요"),
        tip("집중하세요", "스몰탐을 더 정확히 쳐요"),
        tip("스네어 미리", "놓치지 않도록 주의해요"),
        tip("왼손 힘내요"),
    ],
)
def test_vague_words_are_rejected(t: LiveTip) -> None:
    f = facts(
        pads=[
            {"pad": "SMALL_TOM", "notes": 8, "misses": 4},
            {"pad": "SNARE", "notes": 8, "misses": 2},
        ]
    )
    assert "막연한 말을 씀" in check(t, f)


@pytest.mark.parametrize("title", ["박 맞춰요", "손목 풀어", "정신 차려"])
def test_title_needs_a_target_or_direction(title: str) -> None:
    assert "제목에 대상이나 방향이 없음" in check(tip(title), facts(hands={"weakHand": "LEFT"}))


def test_timing_is_described_relative_to_the_judgement_window() -> None:
    slight = build_user_prompt(facts(timing={"meanDeltaMs": 15.0, "goodMs": 60}))
    clear = build_user_prompt(facts(timing={"meanDeltaMs": 15.0, "goodMs": 30}))
    assert "박보다 늦음(살짝)" in slight and "박보다 늦음(많이)" in clear
    # 판정 폭이 없으면(옛 FE) 기본 60ms로 본다
    assert "박보다 늦음(많이)" in build_user_prompt(facts(timing={"meanDeltaMs": 28.4}))
    assert "박에 거의 맞음" in build_user_prompt(facts(timing={"meanDeltaMs": 5.0}))


def test_instead_pad_and_cause_how_are_in_the_prompt_and_allowed() -> None:
    f = facts(
        pads=[{"pad": "SMALL_TOM", "notes": 8, "misses": 4, "instead": "MID_TOM"}],
        ruleCoach={"tags": ["LIVE_PAD_MISS"], "causes": ["WRONG_PAD"]},
    )
    p = build_user_prompt(f)
    assert "칠 차례에 대신 미드탐 침" in p and "고치는 방법:" in p
    assert check(tip("스몰탐 먼저", "미드탐 말고 스몰탐을 쳐요"), f) == []


def test_keyboard_must_press_not_hit() -> None:
    kb = facts(input="keyboard", pads=[])
    assert "키보드인데 스틱 표현을 씀" in check(tip("킥보다 먼저", "킥 소리 전에 내려쳐요"), kb)
    assert "키보드인데 스틱 표현을 씀" in check(tip("킥보다 먼저", "킥 소리보다 먼저 쳐요"), kb)
    assert check(tip("킥 전에 눌러", "킥 소리보다 먼저 눌러요"), kb) == []
    # '고쳐'는 치는 동작이 아니다
    assert "키보드인데 스틱 표현을 씀" not in check(tip("킥 전에 눌러", "박을 고쳐 눌러요"), kb)


def test_naming_only_the_instead_pad_is_rejected() -> None:
    f = facts(pads=[{"pad": "SMALL_TOM", "notes": 8, "misses": 5, "instead": "MID_TOM"}])
    assert "대신 친 패드만 말함" in check(tip("미드탐 먼저", "스틱을 미드탐 쪽으로 옮겨요"), f)
    assert check(tip("스몰탐 먼저", "미드탐 말고 스몰탐을 쳐요"), f) == []


def test_clean_segment_gets_praise_not_correction() -> None:
    clean = facts(
        counts={"perfect": 24, "good": 4, "miss": 0},
        timing={"meanDeltaMs": 3.0, "stdDeltaMs": 9.0, "goodMs": 60},
        pads=[],
        ruleCoach={},
        previous={},
    )
    assert "잘 친 구간에 고치라고 함" in check(tip("킥보다 먼저", "킥 소리 전에 내려쳐요"), clean)
    assert check(tip("지금 그대로", "킥에 맞춘 지금 느낌 좋아요"), clean) == []
    # 놓침이 있으면 고치라는 말을 해도 된다
    assert "잘 친 구간에 고치라고 함" not in check(
        tip("킥보다 먼저", "킥 소리 전에 내려쳐요"),
        facts(timing={"meanDeltaMs": 3.0, "goodMs": 60}),
    )


# --- 습관 개인화 (설계 COACH-001 습관 개인화 3.3~3.5) ---

LATE_HABIT = {"plays": 6, "items": [{"pattern": "TIMING_LATE", "share": "OFTEN"}]}
SMALL_TOM_MISS = {
    "plays": 5,
    "items": [{"pattern": "MISS_CLUSTER", "pad": "SMALL_TOM", "share": "SOMETIMES"}],
}


def steady(**over) -> LiveSegmentFacts:
    """박에 거의 맞고 놓침이 적은 구간"""
    base = {
        "counts": {"perfect": 20, "good": 6, "miss": 1},
        "timing": {"meanDeltaMs": 3.0, "stdDeltaMs": 10.0, "goodMs": 60},
        "pads": [],
        "ruleCoach": {},
        "previous": {},
    }
    base.update(over)
    return facts(**base)


def test_no_habit_keeps_prompt_identical() -> None:
    f = facts()
    with_empty = facts(habit={"plays": 4, "items": []})
    assert build_user_prompt(f) == build_user_prompt(with_empty)
    assert "평소 습관" not in build_user_prompt(f)
    assert habit_match(f) is None


@pytest.mark.parametrize(
    ("habit", "f", "expected"),
    [
        # 박 타이밍
        (LATE_HABIT, facts(), "REPEAT"),
        (LATE_HABIT, steady(), "BETTER"),
        ({"plays": 5, "items": [{"pattern": "TIMING_EARLY"}]}, facts(), None),
        # 패드 놓침: 이번에도 놓침 / 쳤고 문제 없음 / 친 근거 없음
        (
            SMALL_TOM_MISS,
            facts(pads=[{"pad": "SMALL_TOM", "notes": 6, "misses": 3}]),
            "REPEAT",
        ),
        (SMALL_TOM_MISS, steady(playedPads=["SMALL_TOM", "SNARE"]), "BETTER"),
        (SMALL_TOM_MISS, steady(), None),
        (SMALL_TOM_MISS, steady(playedPads=["SNARE"]), None),
        # 패드 늦음
        (
            {"plays": 5, "items": [{"pattern": "PAD_LATE", "pad": "SNARE"}]},
            facts(),
            "REPEAT",
        ),
        (
            {"plays": 5, "items": [{"pattern": "PAD_LATE", "pad": "SNARE"}]},
            facts(pads=[{"pad": "SNARE", "notes": 8, "misses": 3, "meanDeltaMs": -30.0}]),
            None,
        ),
        # 약한 손
        (
            {"plays": 5, "items": [{"pattern": "HAND_WEAK", "hand": "LEFT"}]},
            facts(hands={"weakHand": "LEFT", "ratio": 0.6}),
            "REPEAT",
        ),
        (
            {"plays": 5, "items": [{"pattern": "HAND_WEAK", "hand": "LEFT"}]},
            steady(hands={"weakHand": None, "ratio": 0.95}),
            "BETTER",
        ),
        (
            {"plays": 5, "items": [{"pattern": "HAND_WEAK", "hand": "LEFT"}]},
            facts(input="keyboard", hands={"weakHand": "LEFT", "ratio": 0.6}),
            None,
        ),
        # 박 간격
        (
            {"plays": 5, "items": [{"pattern": "UNSTEADY"}]},
            facts(timing={"meanDeltaMs": 3.0, "stdDeltaMs": 40.0, "goodMs": 60}),
            "REPEAT",
        ),
        ({"plays": 5, "items": [{"pattern": "UNSTEADY"}]}, steady(), "BETTER"),
        # 전환은 이번에도만
        (
            {"plays": 5, "items": [{"pattern": "TRANSITION_MISS"}]},
            facts(ruleCoach={"causes": ["TRANSITION"]}),
            "REPEAT",
        ),
        ({"plays": 5, "items": [{"pattern": "TRANSITION_MISS"}]}, steady(), None),
    ],
)
def test_habit_match_table(habit, f, expected) -> None:
    m = habit_match(f.model_copy(update={"habit": LiveHabit.model_validate(habit)}))
    assert (m.kind if m else None) == expected


def test_repeat_wins_over_better_and_line_has_no_numbers() -> None:
    f = facts(
        playedPads=["SMALL_TOM", "SNARE"],
        habit={
            "plays": 7,
            "items": [
                {"pattern": "MISS_CLUSTER", "pad": "SMALL_TOM"},
                {"pattern": "TIMING_LATE", "share": "OFTEN"},
            ],
        },
    )
    m = habit_match(f)
    assert m is not None and m.kind == "REPEAT" and m.item.pattern == "TIMING_LATE"
    p = build_user_prompt(f)
    assert "평소 습관(자주): 박보다 늦게 침 → 이번 구간에도 같음" in p
    assert "7" not in p.split("평소 습관")[1]


def test_habit_skipped_when_last_tip_spoke_habit() -> None:
    f = facts(
        habit=LATE_HABIT,
        previous={"lastTip": {"title": "킥보다 먼저", "sub": "이번에도 늦어요"}},
    )
    assert habit_match(f) is None
    assert "평소 습관" not in build_user_prompt(f)


def test_habit_guardrails() -> None:
    plain = facts()
    assert "근거 없이 습관을 말함" in check(tip("킥보다 먼저", "평소처럼 늦어요, 먼저 쳐요"), plain)
    repeat = facts(habit=LATE_HABIT)
    assert check(tip("킥보다 먼저", "이번에도 늦어요, 먼저 쳐요"), repeat) == []
    assert "습관 결과와 반대로 말함" in check(tip("킥보다 먼저", "평소보다 좋아졌어요"), repeat)
    assert "탓하는 말을 씀" in check(tip("킥보다 먼저", "또 늦어요, 먼저 쳐요"), repeat)
    assert "탓하는 말을 씀" in check(tip("킥보다 먼저", "자꾸 늦어요"), repeat)
    better = steady(playedPads=["SMALL_TOM"], habit=SMALL_TOM_MISS)
    assert check(tip("스몰탐 그대로", "평소보다 스몰탐이 좋아졌어요"), better) == []
    assert "습관 결과와 반대로 말함" in check(
        tip("스몰탐 그대로", "이번에도 스몰탐 좋아요"), better
    )
    # 습관 패드는 이번 구간 사실에 없어도 말할 수 있다(맞대기 결과가 있을 때만)
    assert "사실에 없는 패드를 말함" not in " ".join(
        check(tip("스몰탐 그대로", "평소보다 스몰탐이 좋아졌어요"), better)
    )
    assert any(
        v.startswith("사실에 없는 패드를 말함")
        for v in check(tip("스몰탐 그대로", "스몰탐이 좋아요"), steady())
    )
    # '늘었어요'는 탓하는 말이 아니다
    assert "탓하는 말을 씀" not in check(tip("킥보다 먼저", "놓침이 늘었어요"), plain)
