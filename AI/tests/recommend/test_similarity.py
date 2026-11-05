"""R2 유사도 포팅(`similarity.py`)이 서비스(BE `SimilarityEngine`)와 같은 성질을 갖는지 확인한다."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ssaplash_ai.recommend.similarity import ChartSimilarity

ROCK = {
    "KICK": [1.0 if i in (0, 6) else 0.0 for i in range(12)],
    "SNARE": [1.0 if i == 0 else 0.0 for i in range(12)],
    "HAT": [0.5 if i in (0, 6) else 0.0 for i in range(12)],
    "CYMBAL": [0.0] * 12,
    "TOM": [0.0] * 12,
}
FOUR = {
    "KICK": [1.0 if i == 0 else 0.0 for i in range(12)],
    "SNARE": [1.0 if i == 0 else 0.0 for i in range(12)],
    "HAT": [1.0 if i == 6 else 0.0 for i in range(12)],
    "CYMBAL": [0.0] * 12,
    "TOM": [0.0] * 12,
}
SHUFFLE = {
    "KICK": [1.0 if i == 0 else 0.0 for i in range(12)],
    "SNARE": [1.0 if i == 4 else 0.0 for i in range(12)],
    "HAT": [0.0] * 12,
    "CYMBAL": [1.0 if i in (0, 8) else 0.0 for i in range(12)],
    "TOM": [0.0] * 12,
}


def row(chart, song, difficulty, density, pads, transitions, groups):
    return {
        "chart_id": chart,
        "song_id": song,
        "difficulty": difficulty,
        "avg_notes_per_sec": density,
        "pad_ratio": pads,
        "transition_ratio": transitions,
        "rhythm_grid": {"groups": groups} if groups is not None else {"excluded": "VARIABLE_TEMPO"},
    }


def build(rows, bpm):
    charts = pd.DataFrame(rows)
    songs = pd.DataFrame({"song_id": sorted(bpm), "bpm": [bpm[s] for s in sorted(bpm)]})
    return ChartSimilarity(charts, songs)


@pytest.fixture
def sim():
    rows = [
        row(
            10,
            1,
            "NORMAL",
            3.0,
            {"KICK": 0.3, "SNARE": 0.2, "HIHAT": 0.5},
            {"KICK>SNARE": 0.4},
            ROCK,
        ),
        row(
            20,
            2,
            "NORMAL",
            3.0,
            {"KICK": 0.3, "SNARE": 0.2, "HIHAT": 0.5},
            {"KICK>SNARE": 0.4},
            ROCK,
        ),  # 곡 1과 같은 리듬
        row(
            30,
            3,
            "NORMAL",
            3.2,
            {"KICK": 0.4, "HIHAT": 0.4, "SNARE": 0.2},
            {"KICK>HIHAT": 0.5},
            FOUR,
        ),
        row(
            40,
            4,
            "NORMAL",
            3.0,
            {"RIDE": 0.7, "SNARE": 0.2, "KICK": 0.1},
            {"RIDE>SNARE": 0.5},
            SHUFFLE,
        ),
        row(
            50, 5, "NORMAL", 3.0, {"KICK": 0.3, "SNARE": 0.2, "HIHAT": 0.5}, {}, None
        ),  # 격자 없음(가변 템포)
        row(
            11, 1, "HARD", 4.5, {"KICK": 0.3, "SNARE": 0.2, "HIHAT": 0.5}, {"KICK>SNARE": 0.4}, ROCK
        ),
        row(
            21, 2, "EASY", 1.8, {"KICK": 0.3, "SNARE": 0.2, "HIHAT": 0.5}, {"KICK>SNARE": 0.4}, ROCK
        ),
    ]
    return build(rows, {1: 120.0, 2: 120.0, 3: 120.0, 4: 120.0, 5: 120.0})


def at(sim, chart):
    return sim.chart_index[chart]


def test_같은_특징의_두_채보는_유사도_1이고_행렬은_대칭이다(sim):
    assert sim.sim[at(sim, 10), at(sim, 20)] == pytest.approx(1.0)
    assert np.allclose(sim.sim, sim.sim.T)
    assert (sim.sim >= 0).all() and (sim.sim <= 1).all()


def test_같은_종류의_리듬이_다른_종류보다_가깝다(sim):
    base = at(sim, 10)
    assert sim.sim[base, at(sim, 20)] > sim.sim[base, at(sim, 30)] > 0
    assert sim.sim[base, at(sim, 30)] > sim.sim[base, at(sim, 40)]


def test_격자가_없는_채보는_비교할_수_없어_모두_0이다(sim):
    broken = at(sim, 50)
    assert not sim.valid[broken]
    assert (sim.sim[broken] == 0).all() and (sim.sim[:, broken] == 0).all()


def test_밀도와_템포가_멀수록_유사도가_낮다():
    same = [
        row(10, 1, "NORMAL", 3.0, {"KICK": 1.0}, {"A>B": 0.5}, ROCK),
        row(20, 2, "NORMAL", 3.0, {"KICK": 1.0}, {"A>B": 0.5}, ROCK),
    ]
    assert build(same, {1: 120.0, 2: 120.0}).sim[0, 1] == pytest.approx(1.0)
    dense = [
        row(10, 1, "NORMAL", 3.0, {"KICK": 1.0}, {"A>B": 0.5}, ROCK),
        row(20, 2, "NORMAL", 12.0, {"KICK": 1.0}, {"A>B": 0.5}, ROCK),
    ]
    far = build(dense, {1: 120.0, 2: 120.0}).sim[0, 1]
    assert far == pytest.approx(1.0 - 0.15)  # 밀도 점수만 0(2 옥타브 차이)
    fast = build(same, {1: 120.0, 2: 200.0}).sim[0, 1]
    assert fast == pytest.approx(1.0 - 0.15)  # 템포가 약 1.41배를 넘으면 템포 점수 0


def test_양쪽_모두_노트가_없는_묶음은_평균에서_빠진다():
    only_kick = {
        "KICK": ROCK["KICK"],
        "SNARE": [0.0] * 12,
        "HAT": [0.0] * 12,
        "CYMBAL": [0.0] * 12,
        "TOM": [0.0] * 12,
    }
    rows = [
        row(10, 1, "NORMAL", 3.0, {"KICK": 1.0}, {"A>B": 0.5}, only_kick),
        row(20, 2, "NORMAL", 3.0, {"KICK": 1.0}, {"A>B": 0.5}, only_kick),
    ]
    assert build(rows, {1: 120.0, 2: 120.0}).sim[0, 1] == pytest.approx(1.0)


def test_한쪽에만_노트가_있는_묶음은_0점으로_센다():
    with_tom = dict(ROCK, TOM=[1.0 if i == 0 else 0.0 for i in range(12)])
    rows = [
        row(10, 1, "NORMAL", 3.0, {"KICK": 1.0}, {"A>B": 0.5}, ROCK),
        row(20, 2, "NORMAL", 3.0, {"KICK": 1.0}, {"A>B": 0.5}, with_tom),
    ]
    sim = build(rows, {1: 120.0, 2: 120.0}).sim[0, 1]
    assert 0.85 < sim < 1.0  # TOM 묶음(가중 0.05)만 어긋난다


def test_곡_단위_점수는_같은_난이도_채보를_고르고_없으면_밀도가_가까운_채보를_고른다(sim):
    s2 = sim.song_index[2]
    # 곡 1의 HARD(4.5)에서 곡 2로: 곡 2에는 HARD가 없으니 밀도가 가까운 NORMAL(3.0)이 EASY(1.8)보다 선택된다
    assert sim.to_song[at(sim, 11), s2] == pytest.approx(sim.sim[at(sim, 11), at(sim, 20)])
    # 곡 1의 NORMAL에서 곡 2로: 같은 난이도 NORMAL
    assert sim.to_song[at(sim, 10), s2] == pytest.approx(sim.sim[at(sim, 10), at(sim, 20)])


def test_곡_단위_점수에서_자기_곡은_1이고_격자_없는_곡은_0이다(sim):
    assert sim.to_song[at(sim, 10), sim.song_index[1]] == 1.0
    assert sim.to_song[at(sim, 10), sim.song_index[5]] == 0.0
