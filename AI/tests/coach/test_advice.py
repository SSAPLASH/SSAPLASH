"""연습 조언(`tip`) 문장: 모든 pattern에 있고, 길이·말투 규칙을 지키고, 패드 이름과 조사가 맞는지 본다."""

from __future__ import annotations

import itertools
import re
from pathlib import Path

import pytest

from ssaplash_ai.coach import advice
from ssaplash_ai.coach.advice import TIP_PATTERNS, tip_for
from ssaplash_ai.coach.config import ENABLED_PATTERNS, MAX_TIP_CHARS, PAD_LABELS_KO

# 알려진 패드 9종과 모르는 이름의 대체값
PADS = [*PAD_LABELS_KO, "OTHER"]


def test_조언이_있는_pattern은_설계의_14개이다():
    assert len(TIP_PATTERNS) == 14


def test_켜진_pattern마다_조언이_있다():
    # 새 규칙을 켤 때 문구를 빼먹지 못하게 한다
    assert ENABLED_PATTERNS <= TIP_PATTERNS
    for pattern in ENABLED_PATTERNS:
        assert tip_for(pattern, ["SNARE", "HIHAT"])


@pytest.mark.parametrize("pattern", sorted(TIP_PATTERNS))
def test_조언은_한국어_완성_문장이고_길이_제한을_지킨다(pattern):
    # 패드 이름이 가장 길어지는 조합까지 모두 본다
    for pads in itertools.product(PADS, repeat=2):
        tip = tip_for(pattern, list(pads))

        assert tip is not None
        assert re.search(r"[가-힣]", tip)
        assert tip.endswith(("요.", "요"))
        assert len(tip) <= MAX_TIP_CHARS, (pattern, pads, len(tip))
        assert not re.search(r"\d", tip), "새 숫자를 만들지 않는다"
        assert "None" not in tip


@pytest.mark.parametrize("pattern", sorted(TIP_PATTERNS))
def test_패드_정보가_없어도_문장이_만들어진다(pattern):
    tip = tip_for(pattern, [])

    assert tip
    assert "None" not in tip


def test_같은_입력은_같은_문장이다():
    first = tip_for("TRANSITION_LATE", ["HIHAT", "SNARE"])
    second = tip_for("TRANSITION_LATE", ["HIHAT", "SNARE"])

    assert first == second


def test_알_수_없는_pattern은_None이다():
    assert tip_for("SOMETHING_NEW", ["SNARE"]) is None


@pytest.mark.parametrize(
    ("pattern", "pads", "expected"),
    [
        ("PAD_LATE", ["SNARE"], "스네어만 따로 골라"),
        ("PAD_EARLY", ["HIHAT_PEDAL"], "하이햇 페달만 따로 골라"),
        # '로'/'으로': 받침이 없거나 ㄹ이면 '로', 그 밖의 받침은 '으로'
        ("TRANSITION_LATE", ["HIHAT", "SMALL_TOM"], "하이햇에서 스몰탐으로 넘어가는"),
        ("TRANSITION_LATE", ["SNARE", "KICK"], "스네어에서 킥으로 넘어가는"),
        ("TRANSITION_MISS", ["KICK", "SNARE"], "킥에서 스네어로 넘어가는"),
        ("TRANSITION_MISS", ["SNARE", "HIHAT_PEDAL"], "하이햇 페달로 넘어가는"),
        # '을'/'를'
        ("TRANSITION_LATE", ["HIHAT", "SNARE"], "하이햇을 치자마자 스네어 쪽으로"),
        ("TRANSITION_LATE", ["SNARE", "HIHAT"], "스네어를 치자마자 하이햇 쪽으로"),
        ("PAD_CONFUSION", ["CRASH"], "크래시를 칠 때"),
        ("PAD_CONFUSION", ["KICK"], "킥을 칠 때"),
    ],
)
def test_패드_이름과_조사가_맞다(pattern, pads, expected):
    assert expected in tip_for(pattern, pads)


def test_HAND_WEAK는_왼손_오른손으로_단정하지_않는다():
    # 어느 스틱이 어느 손인지 문서에 없어서 "약한 쪽 손"이라고만 쓴다
    tip = tip_for("HAND_WEAK", ["SNARE"])

    assert "약한 쪽 손" in tip
    assert "왼손" not in tip
    assert "오른손" not in tip


def test_PAD_CONFUSION은_사용자_실수로_단정하지_않는다():
    tip = tip_for("PAD_CONFUSION", ["SNARE"])

    assert "인식" in tip


def test_advice는_patterns를_가져오지_않는다():
    # 설계의 의존 방향: analyzer → select → advice, advice는 patterns를 모른다
    source = Path(advice.__file__).read_text(encoding="utf-8")

    assert not re.search(r"^\s*(from|import)\s+ssaplash_ai\.coach\.patterns", source, re.MULTILINE)
