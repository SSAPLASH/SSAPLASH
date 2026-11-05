"""그래프 구성(설계 문서 부록 B.5)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import scipy.sparse as sp

from ssaplash_ai.recommend.data import load_dataset, temporal_split
from ssaplash_ai.recommend.graph import _kmeans, build_graph, interaction_weights
from ssaplash_ai.recommend.simulate import SimConfig, generate


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    synthetic = generate(SimConfig(seed=11, n_songs=80, n_users=250, mean_plays=20))
    data = load_dataset(synthetic.write(Path(tmp_path_factory.mktemp("graph")) / "data"), "P0")
    return data, temporal_split(data.interactions)


def frame(rows):
    return pd.DataFrame(rows, columns=["user_key", "song_id", "accuracy", "completed"])


def test_연결_가중치는_완주_정확도_재방문으로_올라가고_상한이_있다():
    rows = [
        ("a", 1, 50.0, False),  # 한 번만, 미완주, 낮은 정확도 → 1.0
        ("b", 1, 90.0, True),  # 완주, 정확도 85 이상 → 2.0
        ("c", 1, 60.0, False),
        ("c", 1, 61.0, False),
        ("c", 1, 62.0, False),
        ("c", 1, 63.0, False),  # 4번 → 재방문 상한 +0.5
        ("d", 1, 90.0, True),
        ("d", 1, 91.0, True),
        ("d", 1, 92.0, True),
        ("d", 1, 93.0, True),
        ("d", 1, 94.0, True),
    ]
    w = interaction_weights(frame(rows)).set_index("user_key")["weight"]
    assert w["a"] == 1.0 and w["b"] == 2.0
    assert w["c"] == 1.5  # 재방문 3번이어도 +0.5까지만
    assert w["d"] == 2.5  # 최대값. 반복 횟수만으로 더 커지지 않는다


def test_인접_행렬은_대칭이고_가중치를_차수로_정규화한다():
    train = frame([("u1", 1, 90.0, True), ("u1", 2, 50.0, False), ("u2", 1, 50.0, False)])
    data = type("D", (), {})()
    data.songs = pd.DataFrame(
        {
            "song_id": [1, 2],
            "bpm": [100.0, 100.0],
            "duration_ms": [1, 1],
            "song_level": ["BEGINNER"] * 2,
        }
    )
    data.chart_features = pd.DataFrame(
        columns=[
            "chart_id",
            "song_id",
            "difficulty",
            "avg_notes_per_sec",
            "pad_ratio",
            "transition_ratio",
            "rhythm_grid",
        ]
    )
    data.song_meta = pd.DataFrame()
    g = build_graph(train, data, features="none")
    a = g.adjacency.toarray()
    assert np.allclose(a, a.T) and g.n_users == 2 and g.n_songs == 2 and g.n_features == 0
    # 원래 가중치: u1-곡1 2.0, u1-곡2 1.0, u2-곡1 1.0. 차수: u1 3, u2 1, 곡1 3, 곡2 1
    assert a[0, 2] == pytest.approx(2.0 / np.sqrt(3 * 3))
    assert a[0, 3] == pytest.approx(1.0 / np.sqrt(3 * 1))
    assert a[1, 2] == pytest.approx(1.0 / np.sqrt(1 * 3))


def test_그래프에는_학습_구간의_연주만_들어간다(world):
    data, split = world
    g = build_graph(split.train, data, features="none")
    users = {u: i for u, i in g.user_index.items()}
    songs = {int(s): i for i, s in enumerate(sorted(data.songs["song_id"]))}
    train_pairs = {
        (users[u], songs[int(s)])
        for u, s in zip(split.train["user_key"], split.train["song_id"], strict=True)
    }
    assert {tuple(p) for p in g.pairs.tolist()} == train_pairs
    assert set(g.user_index) == set(split.train["user_key"])
    assert g.positive.sum() == len(train_pairs)
    assert set(g.known_songs.tolist()) == {songs[int(s)] for s in split.train["song_id"]}


def test_새_곡은_특징이_없으면_연결이_없고_특징이_있으면_이어진다(world):
    data, split = world
    cold = sorted(set(data.songs["song_id"]) - set(split.train["song_id"]))
    assert cold
    songs = sorted(int(s) for s in data.songs["song_id"])
    plain = build_graph(split.train, data, features="none")
    feat = build_graph(split.train, data, features="chart")
    for s in cold:
        node = plain.n_users + songs.index(s)
        assert plain.adjacency[node].nnz == 0
        assert feat.adjacency[node].nnz > 0


def test_특징_묶음마다_합이_feature_weight이다(world):
    from ssaplash_ai.recommend.graph import song_features

    data, _ = world
    features = song_features(data, meta=True, rhythm_clusters=6, seed=0, total=2.0)
    song = next(s for s, f in features.items() if any(k.startswith("rhythm:") for k in f))
    f = features[song]
    for prefix in ("pad", "transition", "mood", "drum"):
        group = [v for k, v in f.items() if k.startswith(prefix + ":")]
        if group:
            assert sum(group) == pytest.approx(2.0)
    for prefix in ("rhythm", "density", "level", "bpm", "genre"):
        assert [v for k, v in f.items() if k.startswith(prefix + ":")] == [2.0]


def test_리듬_격자가_제외된_곡에는_리듬_군집_연결이_없다(world):
    from ssaplash_ai.recommend.graph import song_features

    data, _ = world
    excluded = {
        int(s)
        for s, g in zip(
            data.chart_features["song_id"], data.chart_features["rhythm_grid"], strict=True
        )
        if "groups" not in g
    }
    only_excluded = excluded - {
        int(s)
        for s, g in zip(
            data.chart_features["song_id"], data.chart_features["rhythm_grid"], strict=True
        )
        if "groups" in g
    }
    assert only_excluded
    features = song_features(data, meta=False, rhythm_clusters=6, seed=0, total=1.0)
    for s in only_excluded:
        assert not any(k.startswith("rhythm:") for k in features[s])


def test_메타데이터_옵션을_켜야_장르_노드가_생긴다(world):
    data, split = world
    chart = build_graph(split.train, data, features="chart")
    meta = build_graph(split.train, data, features="chart+meta")
    assert not any(n.startswith("genre:") for n in chart.feature_names)
    assert (
        any(n.startswith("genre:") for n in meta.feature_names)
        and meta.n_features > chart.n_features
    )


def test_같은_입력과_시드는_같은_그래프를_만든다(world):
    data, split = world
    a = build_graph(split.train, data, features="chart", seed=3)
    b = build_graph(split.train, data, features="chart", seed=3)
    assert a.feature_names == b.feature_names and (a.adjacency != b.adjacency).nnz == 0
    assert sp.issparse(a.adjacency) and a.edge_counts()["song_feature"] > 0


def test_알_수_없는_특징_모드는_거부한다(world):
    data, split = world
    with pytest.raises(ValueError):
        build_graph(split.train, data, features="all")


def test_kmeans는_결정적이고_두_덩어리를_나눈다():
    rng = np.random.default_rng(0)
    x = np.vstack([rng.normal(0, 0.05, (20, 4)), rng.normal(5, 0.05, (20, 4))])
    labels = _kmeans(x, 2, seed=1)
    assert len(set(labels[:20])) == 1 and len(set(labels[20:])) == 1 and labels[0] != labels[-1]
    assert np.array_equal(labels, _kmeans(x, 2, seed=1))
    assert list(_kmeans(x[:2], 5, seed=0)) == [0, 1]  # 점이 군집 수보다 적으면 점마다 군집
