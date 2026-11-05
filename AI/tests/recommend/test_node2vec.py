"""Node2Vec(설계 문서 부록 B.6 M4): 랜덤 워크, 스킵그램 기울기, 학습, 누수 방지, 새 곡 처리."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import scipy.sparse as sp

from ssaplash_ai.recommend.data import load_dataset, temporal_split
from ssaplash_ai.recommend.models import Node2Vec, Popularity
from ssaplash_ai.recommend.models.node2vec import (
    _scatter_mean,
    _Walker,
    context_pairs,
    sgns_loss_and_grads,
)
from ssaplash_ai.recommend.simulate import SimConfig, generate

FAST = {
    "dim": 16,
    "walk_length": 10,
    "walks_per_node": 3,
    "window": 2,
    "epochs": 1,
    "batch_size": 4096,
}


def graph_of(edges, n):
    """(a, b, 가중치) 목록으로 대칭 가중 인접 행렬을 만든다."""
    rows = [a for a, b, _ in edges] + [b for a, b, _ in edges]
    cols = [b for a, b, _ in edges] + [a for a, b, _ in edges]
    vals = [w for _, _, w in edges] * 2
    return sp.csr_matrix((vals, (rows, cols)), shape=(n, n))


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    synthetic = generate(SimConfig(seed=19, n_songs=100, n_users=300, mean_plays=22))
    data = load_dataset(synthetic.write(Path(tmp_path_factory.mktemp("n2v")) / "data"), "P0")
    return data, temporal_split(data.interactions)


def fit(world, features="none", **kw):
    data, split = world
    return Node2Vec(features, **{**FAST, **kw}).fit(split.train, data, now=split.cutoff)


# ------------------------------------------------------------------ 랜덤 워크


def test_걷기는_연결된_노드로만_이어지고_모양과_시작점이_맞다():
    w = graph_of([(0, 1, 1), (1, 2, 1), (2, 3, 2), (3, 0, 1), (1, 3, 1)], 4)
    walker = _Walker(w)
    starts = np.array([0, 1, 2, 3, 0, 1])
    walks = walker.walks(starts, 15, 1.0, 1.0, np.random.default_rng(0))
    assert walks.shape == (6, 15) and np.array_equal(walks[:, 0], starts)
    dense = w.toarray()
    assert all(dense[a, b] > 0 for row in walks for a, b in zip(row[:-1], row[1:], strict=True))


def test_다음_노드는_연결_가중치에_비례해_뽑힌다():
    w = graph_of([(0, 1, 1.0), (0, 2, 3.0)], 3)  # 노드 0의 이웃: 1(가중 1), 2(가중 3)
    walker = _Walker(w)
    picks = walker.step(np.zeros(40000, dtype="int64"), np.random.default_rng(1))
    assert abs((picks == 2).mean() - 0.75) < 0.01 and set(np.unique(picks)) == {1, 2}


def test_p가_작으면_바로_전_노드로_자주_되돌아가고_크면_거의_안_돌아간다():
    ring = graph_of([(i, (i + 1) % 8, 1.0) for i in range(8)], 8)
    walker = _Walker(ring)
    starts = np.tile(np.arange(8), 2000)

    def back_rate(p):
        walks = walker.walks(starts, 6, p, 1.0, np.random.default_rng(2))
        return float(np.mean(walks[:, 2:] == walks[:, :-2]))

    assert back_rate(1.0) == pytest.approx(0.5, abs=0.03)
    assert back_rate(0.05) > 0.85
    assert back_rate(20.0) < 0.1


def test_간선_존재_확인은_정확하다():
    walker = _Walker(graph_of([(0, 1, 1), (1, 2, 1)], 4))
    a = np.array([0, 1, 0, 2, 3, 3])
    b = np.array([1, 0, 2, 1, 0, 3])
    assert list(walker.is_edge(a, b)) == [True, True, False, True, False, False]


def test_같은_시드는_같은_걷기를_만든다():
    walker = _Walker(graph_of([(0, 1, 1), (1, 2, 2), (2, 0, 1)], 3))
    starts = np.arange(3).repeat(5)
    a = walker.walks(starts, 12, 0.5, 2.0, np.random.default_rng(7))
    b = walker.walks(starts, 12, 0.5, 2.0, np.random.default_rng(7))
    assert np.array_equal(a, b)


def test_문맥_쌍은_윈도_안의_양방향_쌍이다():
    walks = np.array([[0, 1, 2, 3]])
    centers, contexts = context_pairs(walks, 2)
    pairs = set(zip(centers.tolist(), contexts.tolist(), strict=True))
    assert pairs == {(0, 1), (1, 0), (1, 2), (2, 1), (2, 3), (3, 2), (0, 2), (2, 0), (1, 3), (3, 1)}
    assert len(context_pairs(walks, 10)[0]) == 12  # 윈도가 길어도 걷기 길이까지만


# ------------------------------------------------------------------ 스킵그램 기울기


def test_손으로_쓴_스킵그램_기울기가_수치_미분과_같다():
    """같은 노드가 여러 번 나오는 배치에서, 노드별로 합친 기울기가 유한 차분과 맞는지 확인한다."""
    rng = np.random.default_rng(0)
    n, d, k = 9, 5, 3
    v, u = rng.normal(0, 0.5, (n, d)), rng.normal(0, 0.5, (n, d))
    c = np.array([0, 1, 1, 2, 2, 2, 5, 7])  # 중복 포함
    o = np.array([3, 3, 4, 0, 1, 8, 1, 2])
    neg = rng.integers(0, n, size=(len(c), k))

    def loss_of(vv, uu):
        return sgns_loss_and_grads(vv, uu, c, o, neg)[0]

    _, g_vc, g_uo, g_un, _, _ = sgns_loss_and_grads(v, u, c, o, neg)
    grad_v, _ = _scatter_mean(c, g_vc, n)
    grad_u, _ = _scatter_mean(
        np.concatenate([o, neg.ravel()]), np.concatenate([g_uo, g_un.reshape(-1, d)]), n
    )
    eps = 1e-6
    for node in range(n):
        for dim in (0, 3):
            for target, analytic in ((v, grad_v), (u, grad_u)):
                plus, minus = target.copy(), target.copy()
                plus[node, dim] += eps
                minus[node, dim] -= eps
                numeric = (
                    (loss_of(plus, u) - loss_of(minus, u))
                    if target is v
                    else (loss_of(v, plus) - loss_of(v, minus))
                ) / (2 * eps)
                assert analytic[node, dim] == pytest.approx(numeric, rel=1e-4, abs=1e-8)


def test_손실은_양성_점수가_클수록_작다():
    v = np.array([[1.0, 0.0], [0.0, 1.0]])
    u_good = np.array([[1.0, 0.0], [0.0, 1.0]])
    u_bad = np.array([[-1.0, 0.0], [0.0, -1.0]])
    c, o, neg = np.array([0]), np.array([0]), np.array([[1]])
    assert (
        sgns_loss_and_grads(v, u_good, c, o, neg)[0] < sgns_loss_and_grads(v, u_bad, c, o, neg)[0]
    )


# ------------------------------------------------------------------ 학습과 추천


def test_학습하면_손실이_줄고_같은_시드는_같은_임베딩이다(world):
    a, b = fit(world, "chart", epochs=3, seed=4), fit(world, "chart", epochs=3, seed=4)
    assert a.loss_history[-1] < a.loss_history[0] and all(np.isfinite(a.loss_history))
    assert np.array_equal(a.unit, b.unit) and a.loss_history == b.loss_history
    assert not np.allclose(a.unit, fit(world, "chart", epochs=3, seed=5).unit)


def test_그래프에는_학습_구간_연주만_들어가고_시험_목표는_없다(world):
    data, split = world
    model = fit(world, "none")
    songs = sorted(int(s) for s in data.songs["song_id"])
    users = model.graph.user_index
    targets = {
        (users[r.user_key], songs.index(r.song_id))
        for r in split.warm_test.itertuples()
        if not r.repeat and r.user_key in users
    }
    assert targets and not targets & {tuple(p) for p in model.graph.pairs.tolist()}


def test_점수는_코사인이라_1_이하이고_순위는_이미_친_곡을_뺀다(world):
    model = fit(world, "chart")
    user = next(iter(model.histories))
    scores = model.scores(user)
    assert scores.max() <= 1.0 + 1e-9 and scores.min() >= -1.0 - 1e-9
    top = model.rank(user, 10, exclude=model.seen_songs(user))
    assert len(top) == 10 and not set(top) & model.seen_songs(user)


def test_학습_구간에_없는_사용자는_인기_순서로_대체한다(world):
    data, split = world
    popularity = Popularity().fit(split.train, data, now=split.cutoff)
    assert fit(world, "chart").rank("ghost-user-0001", 10) == popularity.rank("ghost-user-0001", 10)


def test_새_곡은_특징이_없으면_학습되지_않아_점수가_0이고_특징이_있으면_임베딩을_받는다(world):
    data, split = world
    cold = sorted(set(data.songs["song_id"]) - set(split.train["song_id"]))
    assert cold
    plain, feat = fit(world, "none"), fit(world, "chart")
    index = [plain.song_index[s] for s in cold]
    user = next(iter(plain.histories))
    assert np.allclose(plain.song_block[index], 0) and np.allclose(plain.scores(user)[index], 0)
    assert (np.linalg.norm(feat.song_block[index], axis=1) > 0.99).all()  # 단위 벡터
    assert np.abs(feat.scores(user)[index]).max() > 0


def test_이름과_하이퍼파라미터가_변형마다_구분된다():
    names = {f: Node2Vec(f).name for f in ("none", "chart", "chart+meta")}
    assert names == {
        "none": "M4_node2vec",
        "chart": "M4_node2vec_feat",
        "chart+meta": "M4_node2vec_feat_meta",
    }
    params = Node2Vec("chart", dim=8, p=0.5, q=2.0, seed=9).params()
    assert params["dim"] == 8 and params["p"] == 0.5 and params["q"] == 2.0 and params["seed"] == 9
    with pytest.raises(ValueError):
        Node2Vec("everything")
    with pytest.raises(ValueError):
        Node2Vec("chart", p=0)


def test_합성_데이터에서_무작위보다_잘_맞힌다(world):
    """하니스 점검용이다. 합성 데이터의 점수는 모델의 실제 성능이 아니다."""
    data, split = world
    model = fit(world, "none", epochs=3, walks_per_node=6)
    test = split.warm_test[~split.warm_test["repeat"]]
    hits = sum(
        r.song_id in model.rank(r.user_key, 10, exclude=model.seen_songs(r.user_key))
        for r in test.itertuples()
    )
    # 작은 세계(사용자 300명)에서는 Node2Vec이 데이터를 충분히 못 본다. 무작위보다 확실히 낫다는 것만 확인한다
    assert hits / len(test) > 1.2 * (10 / len(data.songs))
