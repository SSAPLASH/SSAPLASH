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
        ("PAD_LATE", ["SNARE"], "스네어만 박에 맞춰"),
        ("PAD_EARLY", ["HIHAT_PEDAL"], "하이햇 페달만 박에 맞춰"),
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
    # 조언은 pads만 받아서 "약한 쪽 손"이라고 쓴다. 어느 손인지는 제목과 설명이 알려 준다
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


# ---------- 약점 상세 설명(detail)과 심각도 단계(severityLevel) ----------

from ssaplash_ai.coach.advice import detail_for, level_for  # noqa: E402
from ssaplash_ai.coach.config import MAX_DETAIL_CHARS  # noqa: E402

# pattern별로 detail이 요구하는 metrics (analyzer가 실제로 채우는 키)
DETAIL_METRICS = {
    "TIMING_LATE": {"hitCount": 40, "meanDeltaMs": 31.2},
    "TIMING_EARLY": {"hitCount": 40, "meanDeltaMs": -31.2},
    "PAD_LATE": {"meanDeltaMs": 32.0, "overallMeanDeltaMs": 5.0, "hitCount": 12},
    "PAD_EARLY": {"meanDeltaMs": -32.0, "overallMeanDeltaMs": -5.0, "hitCount": 12},
    "TRANSITION_LATE": {"meanDeltaMs": 40.0, "hitCount": 8, "transitionCount": 9},
    "TRANSITION_MISS": {"missRate": 0.5, "missCount": 5, "transitionCount": 10},
    "HAND_WEAK": {"velocityRatio": 0.62, "weakHitCount": 20, "strongHitCount": 24},
    "MISS_CLUSTER": {"missRate": 0.4, "missCount": 4, "noteCount": 10},
    "UNSTEADY": {"stdDeltaMs": 31.0, "hitCount": 30},
}


def test_경계값은_윗단계에_속한다():
    assert level_for(0.0) == "LOW"
    assert level_for(0.39) == "LOW"
    assert level_for(0.4) == "MEDIUM"
    assert level_for(0.69) == "MEDIUM"
    assert level_for(0.7) == "HIGH"
    assert level_for(1.0) == "HIGH"


def test_켜진_pattern마다_상세_설명이_있다():
    assert set(DETAIL_METRICS) == set(ENABLED_PATTERNS)
    for pattern, metrics in DETAIL_METRICS.items():
        assert detail_for(pattern, ["SNARE", "HIHAT"], metrics, 7000.0, 12000.0)


@pytest.mark.parametrize("pattern", sorted(DETAIL_METRICS))
def test_상세_설명은_한국어_완성_문장이고_길이_제한을_지킨다(pattern):
    for pads in itertools.product(PADS, repeat=2):
        detail = detail_for(pattern, list(pads), DETAIL_METRICS[pattern], 7000.0, 12000.0)

        assert detail is not None
        assert re.search(r"[가-힣]", detail)
        assert detail.endswith(("요.", "요"))
        assert len(detail) <= MAX_DETAIL_CHARS, (pattern, pads, len(detail))
        assert "None" not in detail


def test_상세_설명의_숫자는_metrics_값이거나_그_산술이다():
    # 입력에 없던 숫자가 문장에 나오지 않는지 본다
    cases = {
        "TIMING_LATE": {"40"},
        "PAD_LATE": {"27"},  # |32.0 − 5.0|
        "TRANSITION_LATE": {"9"},
        "TRANSITION_MISS": {"5", "10"},
        "HAND_WEAK": {"62", "20", "24"},
        "MISS_CLUSTER": {"5", "10", "4"},  # 5 = (12000 − 7000) ÷ 1000
        "UNSTEADY": {"31", "30"},
    }
    for pattern, allowed in cases.items():
        detail = detail_for(pattern, ["SNARE", "HIHAT"], DETAIL_METRICS[pattern], 7000.0, 12000.0)

        assert set(re.findall(r"\d+", detail)) == allowed, (pattern, detail)


def test_전체_경향_pattern의_상세_설명은_곡_전체라고_밝힌다():
    for pattern in ("TIMING_LATE", "TIMING_EARLY"):
        detail = detail_for(pattern, [], DETAIL_METRICS[pattern], 0.0, 1.0)

        assert "곡 전체" in detail


def test_필요한_metrics가_없거나_꺼진_pattern이면_None이다():
    assert detail_for("MISS_CLUSTER", [], {}, 0.0, 5000.0) is None
    assert detail_for("TEMPO_DRIFT_FAST", [], {}, 0.0, 5000.0) is None
    assert detail_for("SOMETHING_NEW", [], {"hitCount": 3}, 0.0, 5000.0) is None


def test_같은_입력은_같은_상세_설명이다():
    args = ("PAD_LATE", ["SNARE"], DETAIL_METRICS["PAD_LATE"], 0.0, 1.0)

    assert detail_for(*args) == detail_for(*args)


@pytest.mark.parametrize("pattern", sorted(ENABLED_PATTERNS))
def test_조언은_앱에_없는_기능을_권하지_않는다(pattern):
    # 리듬 게임과 악보 연습에는 템포 조절과 구간 반복이 없다
    tip = tip_for(pattern, ["SNARE", "KICK"]) or ""
    for word in ("템포", "구간만", "부분만", "박 소리"):
        assert word not in tip


@pytest.mark.parametrize(("stick", "hand"), [(0, "왼손"), (1, "오른손"), (None, "약한 쪽 손")])
def test_손_약점_설명은_어느_손인지_알려_준다(stick, hand):
    metrics = {"velocityRatio": 0.6, "weakHitCount": 20, "strongHitCount": 20}
    if stick is not None:
        metrics["weakStickId"] = stick
    assert detail_for("HAND_WEAK", [], metrics, 0, 1000).startswith(f"{hand}이 다른 손의 60%")


def test_박자_불안정_설명은_표준편차를_평균이라고_하지_않는다():
    detail = detail_for("UNSTEADY", [], {"stdDeltaMs": 32.0, "hitCount": 40}, 0, 1000)
    assert "약 32ms 폭" in detail and "평균" not in detail
