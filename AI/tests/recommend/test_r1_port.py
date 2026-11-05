"""R1 규칙 점수 포팅(`r1.py`)이 서비스(BE `RecommendationScorer`)와 같은 판단을 하는지 확인한다.

BE의 `RecommendationScorerTest`와 같은 시나리오를 파이썬으로 옮겼다. 계수나 규칙을 바꾸면 양쪽 테스트가 함께 바뀌어야 한다.
"""

from __future__ import annotations

import pandas as pd
import pytest

from ssaplash_ai.recommend import r1
from ssaplash_ai.recommend.r1 import Candidate, Profile

NOW = pd.Timestamp("2026-11-05T00:00:00Z")


def chart(song, chart_id, difficulty="NORMAL", level="INTERMEDIATE", density=3.0, pads=None):
    return Candidate(song, chart_id, difficulty, level, density, pads or {"SNARE": 1.0})


def simple(song, density):
    return chart(song, song * 10, density=density)


def profile(base, weak=None, last=None, best=None):
    return Profile(base, weak or {}, last or {}, best or {})


def songs(ranked):
    return [s.candidate.song_id for s in ranked]


def test_도전_점수는_구간_안에서_최고이고_벗어날수록_줄어든다():
    assert r1.challenge(1.10) == 1.0 and r1.challenge(1.25) == 1.0
    assert r1.challenge(0.5) == 0.0 and r1.challenge(1.5) == 0.0
    assert 0.0 < r1.challenge(0.8) < 1.0
    assert r1.challenge(1.0) > r1.challenge(0.8)


def test_기록이_없으면_BEGINNER의_가장_쉬운_채보를_STARTER로_추천한다():
    items = [
        chart(1, 10, "EASY", "BEGINNER", 2.0),
        chart(1, 11, "HARD", "BEGINNER", 4.0),
        chart(2, 20, "NORMAL", "ADVANCED", 7.0),
        chart(3, 30, "NORMAL", "BEGINNER", 1.5),
    ]
    ranked = r1.rank(items, profile(None), NOW, 5)
    assert [s.candidate.chart_id for s in ranked] == [30, 10]
    assert all(s.reasons == ("STARTER",) for s in ranked)


def test_기준_밀도의_1점5배를_넘는_채보는_제외한다():
    ranked = r1.rank([simple(1, 6.0), simple(2, 4.6), simple(3, 4.5)], profile(3.0), NOW, 5)
    assert songs(ranked) == [3]


def test_곡당_하나만_나오고_점수가_높은_채보를_고른다():
    items = [
        chart(1, 10, "EASY", density=1.0),
        chart(1, 11, "NORMAL", density=3.3),
        chart(1, 12, "HARD", density=4.0),
    ]
    ranked = r1.rank(items, profile(3.0), NOW, 5)
    assert len(ranked) == 1 and ranked[0].candidate.chart_id == 11  # 3.3/3.0 = 1.1


def test_약점_패드_비율이_높은_채보의_점수가_올라간다():
    snare = chart(1, 10, density=3.3, pads={"SNARE": 0.8, "KICK": 0.2})
    kick = chart(2, 20, density=3.3, pads={"SNARE": 0.1, "KICK": 0.9})
    weak = r1.rank([snare, kick], profile(3.0, weak={"SNARE": 0.9}), NOW, 5)
    assert songs(weak)[0] == 1 and "WEAK_PAD" in weak[0].reasons
    plain = {s.candidate.song_id: s.total for s in r1.rank([snare, kick], profile(3.0), NOW, 5)}
    assert weak[0].total > plain[1]


def test_안_친_곡은_새로움을_받고_최근_친_곡은_받지_않는다():
    ranked = r1.rank(
        [simple(1, 3.3), simple(2, 3.3)],
        profile(3.0, last={2: NOW - pd.Timedelta(hours=1)}),
        NOW,
        5,
    )
    assert songs(ranked)[0] == 1 and "NEW_SONG" in ranked[0].reasons
    assert "NEW_SONG" not in ranked[1].reasons


def test_오래_안_친_곡은_새로움의_절반을_받는다():
    old = profile(3.0, last={1: NOW - pd.Timedelta(days=20)})
    recent = profile(3.0, last={1: NOW - pd.Timedelta(days=1)})
    a = r1.rank([simple(1, 3.3)], old, NOW, 5)[0].total
    b = r1.rank([simple(1, 3.3)], recent, NOW, 5)[0].total
    assert a - b == pytest.approx(r1.W_NEW * 0.5, abs=1e-3)


def test_목표_정확도_바로_아래로_친_채보는_재도전_이유를_받는다():
    last = {1: NOW - pd.Timedelta(hours=1)}
    assert (
        "RETRY"
        in r1.rank([simple(1, 3.3)], profile(3.0, last=last, best={10: 80.0}), NOW, 5)[0].reasons
    )
    assert (
        "RETRY"
        not in r1.rank([simple(1, 3.3)], profile(3.0, last=last, best={10: 90.0}), NOW, 5)[
            0
        ].reasons
    )


def test_어떤_이유도_넘지_못해도_이유가_하나_이상_있다():
    ranked = r1.rank(
        [simple(1, 2.4)], profile(3.0, last={1: NOW - pd.Timedelta(seconds=60)}), NOW, 5
    )
    assert ranked[0].reasons == ("CHALLENGE",)


def test_이유_종류가_다르면_같은_대표_이유는_절반을_넘지_않는다():
    items = [chart(i, i * 10, density=3.3, pads={"KICK": 1.0}) for i in range(1, 5)]
    items += [chart(i, i * 10, density=1.5, pads={"SNARE": 1.0}) for i in range(5, 7)]
    ranked = r1.rank(items, profile(3.0, weak={"SNARE": 1.0}), NOW, 4)
    assert len(ranked) == 4
    assert (
        sum(s.primary == "CHALLENGE" for s in ranked) == 2
        and sum(s.primary == "WEAK_PAD" for s in ranked) == 2
    )


def test_후보가_한_종류뿐이면_남는_자리를_채운다():
    ranked = r1.rank([simple(i, 3.3) for i in range(1, 7)], profile(3.0), NOW, 4)
    assert len(ranked) == 4


def test_같은_입력은_후보_순서와_무관하게_같은_결과를_준다():
    items = [simple(i, 2.0 + i * 0.3) for i in range(1, 9)]
    p = profile(3.0, weak={"SNARE": 0.5}, last={2: NOW - pd.Timedelta(seconds=60)}, best={30: 75.0})
    first = r1.rank(items, p, NOW, 5)
    assert r1.rank(list(reversed(items)), p, NOW, 5) == first


def test_후보가_없으면_빈_목록():
    assert r1.rank([], profile(3.0), NOW, 5) == []
    assert r1.rank([], profile(None), NOW, 5) == []


# ------------------------------------------------------------------ 프로필 만들기


def plays(rows):
    frame = pd.DataFrame(rows, columns=["song_id", "chart_id", "played_at", "accuracy"])
    frame["played_at"] = pd.to_datetime(frame["played_at"], utc=True)
    return frame


DENS = {10: 2.0, 20: 3.0, 30: 5.0}
PADS = {10: {"KICK": 0.5, "SNARE": 0.5}, 20: {"SNARE": 1.0}, 30: {"HIHAT": 1.0}}


def test_기준_밀도는_최근_10판_중_85퍼센트_이상인_판의_최대_밀도():
    p = plays(
        [(1, 10, "2026-10-01", 90.0), (2, 20, "2026-10-02", 70.0), (3, 30, "2026-10-03", 86.0)]
    )
    assert r1.build_profile(p, DENS, PADS, NOW).baseline_density == 5.0
    low = plays([(1, 10, "2026-10-01", 60.0), (2, 20, "2026-10-02", 70.0)])
    assert r1.build_profile(low, DENS, PADS, NOW).baseline_density is None


def test_기준_밀도는_최근_10판만_본다():
    rows = [(3, 30, "2026-09-01", 95.0)] + [(1, 10, f"2026-10-{d:02d}", 90.0) for d in range(1, 11)]
    assert (
        r1.build_profile(plays(rows), DENS, PADS, NOW).baseline_density == 2.0
    )  # 오래된 5.0짜리 판은 밀려난다


def test_약한_패드는_낮은_정확도로_친_최근_연주의_패드_비율로_근사한다():
    p = plays([(2, 20, "2026-10-01", 90.0), (1, 10, "2026-10-02", 45.0)])
    weak = r1.build_profile(p, DENS, PADS, NOW).weak_pads
    assert set(weak) == {"KICK", "SNARE"}  # 정확도 90인 판은 약점이 없다
    assert weak["KICK"] == pytest.approx(weak["SNARE"]) and 0 < weak["KICK"] <= 1


def test_곡별_마지막_연주와_채보별_최고_정확도를_모은다():
    p = plays(
        [(1, 10, "2026-10-01", 70.0), (1, 10, "2026-10-05", 82.0), (2, 20, "2026-10-03", 60.0)]
    )
    profile_ = r1.build_profile(p, DENS, PADS, NOW)
    assert profile_.song_last_played[1] == pd.Timestamp("2026-10-05", tz="UTC")
    assert profile_.chart_best_accuracy == {10: 82.0, 20: 60.0}
