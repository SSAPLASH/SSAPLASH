"""LLM 총평의 사실→프롬프트→가드레일→폴백. 모델 없이 가짜 생성기로 본다."""

from __future__ import annotations

import pytest

from ssaplash_ai.coach.config import MAX_NARRATIVE_CHARS
from ssaplash_ai.coach.narrative import (
    SYSTEM_PROMPT,
    NarrativeFacts,
    build_user_prompt,
    check,
    write_narrative,
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


# ---------- 가드레일 ----------


def test_사실에_맞는_코치_문장은_통과한다():
    assert check(GOOD_TEXT, _facts()) == []


def test_사실에_없는_숫자는_걸린다():
    problems = check(GOOD_TEXT.replace("4개를", "7개를").replace("10개 중", "35개 중"), _facts())

    assert any("사실에 없는 숫자" in p for p in problems)


def test_백분율과_구간_길이_같은_파생_숫자는_허용한다():
    text = "놓침이 25%예요. 5초 동안 몰려 있었어요. 느린 템포로 천천히 반복해 보세요."

    assert check(text, _facts()) == []


@pytest.mark.parametrize("word", ["점수", "정확도", "못해요", "형편없", "최악"])
def test_점수와_비난_표현은_걸린다(word):
    assert any(word in p for p in check(f"{word}이 눈에 띄어요. 연습해 보세요.", _facts()))


def test_마크다운과_목록과_줄바꿈은_걸린다():
    assert check("**잘 쳤어요.**", _facts())
    assert check("- 스네어를 연습해 보세요.", _facts())
    assert check("잘 쳤어요.\n더 연습해 보세요.", _facts())


@pytest.mark.parametrize(
    "text", ["good job 잘 쳤어요.", "잘 쳤어요 很好.", "잘 쳤어요 😀 연습해 보세요."]
)
def test_다른_나라_글자와_이모지는_걸린다(text):
    assert any("한글이 아닌 글자" in p for p in check(text, _facts()))


def test_길이를_넘으면_걸린다():
    assert any("넘음" in p for p in check("잘 쳤어요. " * 80, _facts()))
    assert len("잘 쳤어요. " * 80) > MAX_NARRATIVE_CHARS


def test_사실에_없는_패드_이름은_걸린다():
    problems = check("라이드는 특히 안정적으로 쳤어요. 연습해 보세요.", _facts())

    assert any("사실에 없는 패드" in p for p in problems)


def test_완성_문장이_아니면_걸린다():
    assert check("전체적으로 잘 잡혀 있고", _facts())
    assert check("", _facts())


# ---------- 이전 플레이 비교 ----------


def test_기록이_없는데_지난번과_비교하면_걸린다():
    problems = check("지난번보다 좋아졌어요. 계속 연습해 보세요.", _facts())

    assert any("기록이 없는데" in p for p in problems)


def test_놓침이_줄었으면_줄었다고_쓸_수_있다():
    facts = _facts(history=_history(miss=18))  # 직전 18/48 = 38%, 이번 10/40 = 25%

    assert check("지난번보다 놓침이 줄었어요. 7~12초 구간을 반복해 보세요.", facts) == []
    assert any("나빠졌다고" in p for p in check("지난번보다 나빠졌어요. 연습해 보세요.", facts))


def test_놓침이_늘었는데_나아졌다고_하면_걸린다():
    facts = _facts(history=_history(miss=2))  # 직전 2/32 = 6%, 이번 25%

    assert any("나아졌다고" in p for p in check("지난번보다 좋아졌어요. 연습해 보세요.", facts))
    assert check("지난번보다 놓침이 늘었어요. 7~12초 구간을 반복해 보세요.", facts) == []


def test_놓침_비율_변화는_퍼센트포인트로_쓸_수_있다():
    # 25% → 직전 38%: 13%p 변화. 이전 플레이 번호와 개수는 사실에 있다
    facts = _facts(history=_history(miss=18))

    assert check("지난번보다 놓침이 13% 줄었어요. 7~12초 구간을 반복해 보세요.", facts) == []


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


# ---------- 생성과 폴백 ----------


def test_첫_시도가_통과하면_한_번만_부른다():
    calls = []

    def generator(system, user):
        calls.append(user)
        return GOOD_TEXT

    outcome = write_narrative(_facts(), generator)

    assert (outcome.text, outcome.attempts, outcome.violations) == (GOOD_TEXT, 1, [])
    assert len(calls) == 1


def test_첫_시도가_걸리면_문제를_알려_주고_다시_부른다():
    prompts = []
    replies = iter(["점수가 낮아요. 연습해 보세요.", GOOD_TEXT])

    def generator(system, user):
        prompts.append(user)
        return next(replies)

    outcome = write_narrative(_facts(), generator)

    assert outcome.text == GOOD_TEXT and outcome.attempts == 2
    assert "이전 시도의 문제" in prompts[1] and "점수" in prompts[1]
    assert "이전 시도의 문제" not in prompts[0]


def test_두_번_모두_걸리면_문장_없이_이유를_돌려준다():
    outcome = write_narrative(_facts(), lambda s, u: "good job")

    assert outcome.text is None and outcome.attempts == 2
    assert outcome.violations


def test_생성기가_예외를_던지면_재시도하지_않고_실패로_돌려준다():
    calls = []

    def generator(system, user):
        calls.append(1)
        raise RuntimeError("모델 적재 실패")

    outcome = write_narrative(_facts(), generator)

    assert outcome.text is None and outcome.attempts == 1 and len(calls) == 1
    assert outcome.violations == ["생성기 오류 RuntimeError"]


def test_같은_사실과_같은_생성기는_같은_결과다():
    first = write_narrative(_facts(), lambda s, u: GOOD_TEXT)
    second = write_narrative(_facts(), lambda s, u: GOOD_TEXT)

    assert first == second


# ---------- 분석 응답 → 사실 ----------


def test_분석_응답에서_사실을_만들고_가드레일을_통과하는_문장이_나온다():
    import json
    from pathlib import Path

    from ssaplash_ai.coach import AnalysisRequest, analyze
    from ssaplash_ai.coach.narrative import Counts, facts_from_analysis

    samples = json.loads(
        (Path(__file__).parent.parent / "fixtures" / "coach" / "samples.json").read_text(
            encoding="utf-8"
        )
    )
    response = analyze(AnalysisRequest.model_validate(samples["A"]["request"]))

    facts = facts_from_analysis(response, Counts(perfect=14, good=8, miss=4))

    assert facts is not None and facts.focusPattern == "MISS_CLUSTER"
    assert [s.scope for s in facts.segments] == ["WHOLE", "SEGMENT"]
    assert all("scope" not in s.metrics for s in facts.segments)
    assert (
        check(
            "7~12초 구간에서 노트 10개 중 4개를 놓쳤어요. 그 부분만 느린 템포로 반복해 보세요.",
            facts,
        )
        == []
    )


def test_표본이_부족해_총평이_없으면_사실도_없다():
    from ssaplash_ai.coach.narrative import Counts, facts_from_analysis
    from ssaplash_ai.coach.schema import AnalysisResponse

    response = AnalysisResponse(
        analyzerVersion="x", reason="INSUFFICIENT_HITS", weakSegments=[], summary=None
    )

    assert facts_from_analysis(response, Counts(perfect=1, good=0, miss=0)) is None


# ---------- 출력 정리와 오탐 줄이기 ----------


def test_모델_전용_토큰과_생각_블록과_줄바꿈을_정리한다():
    from ssaplash_ai.coach.narrative import clean

    assert clean("<think>\n\n</think>\n\n잘 쳤어요.\n연습해 보세요.[|endofturn|]") == (
        "잘 쳤어요. 연습해 보세요."
    )
    assert clean("잘 쳤어요.<|im_end|><end_of_turn>") == "잘 쳤어요."
    assert clean("<think>생각 중</think>좋아요.") == "좋아요."


def test_전용_토큰이_섞여_와도_문장이_통과한다():
    outcome = write_narrative(_facts(), lambda s, u: GOOD_TEXT + "[|endofturn|]")

    assert outcome.text == GOOD_TEXT and outcome.attempts == 1


def test_줄바꿈이_섞여도_한_문단으로_합쳐_통과한다():
    outcome = write_narrative(_facts(), lambda s, u: GOOD_TEXT.replace(". ", ".\n"))

    assert outcome.text == GOOD_TEXT


def test_비교가_아닌_평범한_문장의_향상_개선은_걸리지_않는다():
    # 직전보다 놓침이 늘어도 "실력이 향상돼요"는 지난번과의 비교가 아니다
    facts = _facts(history=_history(miss=2))

    assert (
        check("꾸준히 연습하면 실력이 향상돼요. 7~12초 구간을 느린 템포로 개선해 보세요.", facts)
        == []
    )


def test_기록이_없을_때_지난번_말이_없으면_늘었다_줄었다는_걸리지_않는다():
    assert (
        check("놓침이 줄도록 7~12초 구간을 반복해 보세요. 기본기는 늘 수 있어요.", _facts()) == []
    )


def test_비교_문장_안에서만_방향을_본다():
    facts = _facts(history=_history(miss=2))  # 놓침이 늘었다

    assert any(
        "나아졌다고" in p for p in check("이전보다 박자가 개선됐어요. 연습해 보세요.", facts)
    )
    assert check("연습하면 개선돼요. 이전보다 놓침이 늘었어요.", facts) == []


def test_거절돼도_마지막_원문을_남긴다():
    outcome = write_narrative(_facts(), lambda s, u: "점수가 낮아요.")

    assert outcome.text is None and outcome.last_text == "점수가 낮아요."


# ---------- 실제 모델 출력에서 본 허점 (gemma3·exaone 비교, 2026-11-04) ----------


def test_이모지는_지우고_느낌표로_끝나는_문장도_통과한다():
    from ssaplash_ai.coach.narrative import clean

    assert clean("잘 쳤어요! 🎶 연습해 보세요! 💪") == "잘 쳤어요! 연습해 보세요!"
    text = "기본기가 잘 잡혀 있어요. 7~12초 구간을 느린 템포로 반복해 보세요! 🎶💪"
    outcome = write_narrative(_facts(), lambda s, u: text)

    assert outcome.text is not None and "🎶" not in outcome.text


def test_줄어들었지만_같은_활용형도_비교_방향으로_본다():
    facts = _facts(history=_history(miss=1))  # 직전 1개, 이번 4개: 놓침이 늘었다

    problems = check("지난 연주에 비해 놓침이 줄어들었지만 여전히 연습이 필요해요.", facts)

    assert any("나아졌다고" in p for p in problems)


def test_늘어났다_증가했다도_좋아진_경우엔_걸린다():
    facts = _facts(history=_history(miss=18))  # 놓침이 줄었다

    assert any(
        "나빠졌다고" in p for p in check("이전보다 놓침이 늘어났어요. 연습해 보세요.", facts)
    )
    assert any(
        "나빠졌다고" in p for p in check("이전보다 놓침이 증가했어요. 연습해 보세요.", facts)
    )


def test_약점으로_지목된_패드를_칭찬하면_걸린다():
    problems = check("스네어 연주가 특히 좋았어요. 7~12초 구간을 반복해 보세요.", _facts())

    assert any("약점 패드를 칭찬함" in p for p in problems)


def test_잘한_패드로_꼽힌_패드는_칭찬해도_된다():
    facts = _facts(
        strengthPad="SNARE",
        segments=[
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
    )

    assert check("스네어 연주가 특히 좋았어요. 7~12초 구간을 반복해 보세요.", facts) == []


def test_약점_패드가_칭찬_문장이_아닌_곳에_나오면_걸리지_않는다():
    assert check("스네어로 7~12초 구간을 느린 템포로 반복해 보세요.", _facts()) == []


def test_프롬프트에는_영어_항목_이름이_없고_한국어_이름이_있다():
    prompt = build_user_prompt(_facts())

    assert "meanDeltaMs" not in prompt and "missRate" not in prompt
    assert "놓침 비율 0.4" in prompt and "놓친 개수 4" in prompt


def test_프롬프트는_비교_결과를_한_가지로_정해_준다():
    better = build_user_prompt(_facts(history=_history(miss=18)))
    worse = build_user_prompt(_facts(history=_history(miss=1)))

    assert "비교 결과" in better and "38%에서 이번 25%로 줄었음(좋아짐)" in better
    assert "늘었음(나빠짐)" in worse
    assert "지난 연주의 약점" not in better  # 약점이 나아졌는지 모델이 짐작하지 않게 뺀다


def test_재시도_안내는_그_내용을_문장에서_말하지_말라고_알린다():
    prompt = build_user_prompt(_facts(), hint="점수 금지")

    assert "이전 시도의 문제" in prompt and "말하지 말고" in prompt


def test_숫자_뒤의_단위_ms는_영어_글자로_치지_않는다():
    facts = _facts(
        segments=[
            {
                "pattern": "TIMING_LATE",
                "severityLevel": "LOW",
                "pads": [],
                "fromMs": 1000.0,
                "toMs": 20000.0,
                "scope": "WHOLE",
                "metrics": {"severity": 0.36, "meanDeltaMs": 21.7, "hitCount": 22},
            }
        ],
        strengthPad=None,
        focusPattern="TIMING_LATE",
    )

    assert check("평균 21.7ms 늦게 치고 있어요. 박 소리를 듣고 제때 쳐 보세요.", facts) == []
    assert check("평균 21.7 ms로 늦게 치고 있어요. 박 소리를 듣고 제때 쳐 보세요.", facts) == []
    assert check("평균 21.7ms 늦게 쳐요. good job이에요.", facts)  # 다른 영어는 여전히 걸린다
