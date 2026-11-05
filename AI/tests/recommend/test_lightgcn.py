"""LightGCN(설계 문서 부록 B.6 M5): 손으로 쓴 기울기, 학습, 누수 방지, 새 곡 처리, 재현성."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import scipy.sparse as sp

from ssaplash_ai.recommend.data import load_dataset, temporal_split
from ssaplash_ai.recommend.evaluate import EvalConfig, evaluate, ranking_stability
from ssaplash_ai.recommend.models import LightGCN, Popularity
from ssaplash_ai.recommend.models.lightgcn import propagate
from ssaplash_ai.recommend.simulate import SimConfig, generate

FAST = {"epochs": 15, "dim": 16}


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    synthetic = generate(SimConfig(seed=13, n_songs=100, n_users=400, mean_plays=22))
    data = load_dataset(synthetic.write(Path(tmp_path_factory.mktemp("gcn")) / "data"), "P0")
    split = temporal_split(data.interactions)
    return data, split


def fit(world, features="none", **kw):
    data, split = world
    return LightGCN(features, **{**FAST, **kw}).fit(split.train, data, now=split.cutoff)


# ------------------------------------------------------------------ 전파와 기울기


def test_전파는_층별_이웃_평균이다():
    a = sp.csr_matrix(np.array([[0, 0.5], [0.5, 0]]))
    x = np.array([[1.0, 2.0], [3.0, 4.0]])
    assert np.allclose(propagate(a, x, 0), x)
    assert np.allclose(propagate(a, x, 1), (x + a @ x) / 2)
    assert np.allclose(propagate(a, x, 2), (x + a @ x + a @ (a @ x)) / 3)


@pytest.mark.parametrize("features", ["none", "chart"])
@pytest.mark.parametrize("reg", [0.0, 1e-2])
def test_손으로_쓴_기울기가_수치_미분과_같다(world, features, reg):
    """LightGCN의 핵심 위험: 역전파를 손으로 썼으므로 유한 차분과 맞는지 직접 확인한다."""
    model = fit(world, features, epochs=0, reg=reg, layers=2)
    g = model.graph
    rng = np.random.default_rng(0)
    e0 = rng.normal(0, 0.3, (g.n_nodes, model.dim))
    batch = g.pairs[rng.choice(len(g.pairs), 24, replace=False)]
    u, i = batch[:, 0], batch[:, 1]
    j = model._negatives(g, u, g.known_songs, rng)
    loss, grad = model._gradient(g, e0, u, i, j, g.n_users)
    assert np.isfinite(loss) and grad.shape == e0.shape

    touched = np.unique(np.concatenate([u, g.n_users + i, g.n_users + j]))
    eps = 1e-6
    for node in rng.choice(touched, 6, replace=False):
        for dim in (0, 5):
            plus, minus = e0.copy(), e0.copy()
            plus[node, dim] += eps
            minus[node, dim] -= eps
            numeric = (
                model._gradient(g, plus, u, i, j, g.n_users)[0]
                - model._gradient(g, minus, u, i, j, g.n_users)[0]
            ) / (2 * eps)
            assert grad[node, dim] == pytest.approx(numeric, rel=1e-4, abs=1e-8)


def test_배치에_나오지_않았고_이웃도_없는_노드의_기울기는_0이다(world):
    model = fit(world, "none", epochs=0, layers=1)
    g = model.graph
    rng = np.random.default_rng(1)
    e0 = rng.normal(0, 0.3, (g.n_nodes, model.dim))
    batch = g.pairs[:8]
    j = model._negatives(g, batch[:, 0], g.known_songs, rng)
    _, grad = model.__class__._gradient(model, g, e0, batch[:, 0], batch[:, 1], j, g.n_users)
    cold = [g.n_users + s for s in range(g.n_songs) if s not in set(g.known_songs.tolist())]
    assert cold and np.allclose(grad[cold], 0)


# ------------------------------------------------------------------ 학습


def test_학습하면_손실이_크게_줄어든다(world):
    model = fit(world, "chart", epochs=30)
    assert model.loss_history[0] == pytest.approx(np.log(2), abs=0.05)  # 무작위 시작은 ln 2
    # 손실에는 정규화 항이 들어 있어 reg가 클수록 바닥이 높다(기본 reg에서 약 0.67배)
    assert model.loss_history[-1] < 0.75 * model.loss_history[0]
    assert np.mean(model.loss_history[-3:]) < np.mean(model.loss_history[:3])
    assert all(np.isfinite(model.loss_history))


def test_음성_표본은_사용자가_친_곡이_아니고_학습_구간에_있던_곡이다(world):
    model = fit(world, "none", epochs=0)
    g = model.graph
    rng = np.random.default_rng(2)
    u = g.pairs[:, 0]
    j = model._negatives(g, u, g.known_songs, rng)
    assert set(j.tolist()) <= set(g.known_songs.tolist())  # 새 곡은 음성으로 뽑지 않는다
    assert g.positive[u, j].mean() < 0.01


def test_같은_시드는_같은_임베딩이고_다른_시드는_다르다(world):
    a, b, c = fit(world, "chart", seed=4), fit(world, "chart", seed=4), fit(world, "chart", seed=5)
    assert np.array_equal(a.final, b.final) and a.loss_history == b.loss_history
    assert not np.allclose(a.final, c.final)


def test_학습은_학습_구간_연주만_본다(world):
    data, split = world
    model = fit(world, "none")
    users = model.graph.user_index
    songs = sorted(int(s) for s in data.songs["song_id"])
    targets = {
        (users[r.user_key], songs.index(r.song_id))
        for r in split.warm_test.itertuples()
        if not r.repeat and r.user_key in users
    }
    pairs = {tuple(p) for p in model.graph.pairs.tolist()}
    assert targets and not targets & pairs  # 시험 목표 연주는 그래프에 없다


# ------------------------------------------------------------------ 추천 동작


def test_순위는_이미_친_곡을_빼고_k개를_준다(world):
    model = fit(world, "chart")
    user = next(iter(model.histories))
    top = model.rank(user, 10, exclude=model.seen_songs(user))
    assert len(top) == 10 and not set(top) & model.seen_songs(user)


def test_학습_구간에_없는_사용자는_인기_순서로_대체한다(world):
    data, split = world
    model = fit(world, "chart")
    popularity = Popularity().fit(split.train, data, now=split.cutoff)
    assert model.rank("ghost-user-0001", 10) == popularity.rank("ghost-user-0001", 10)


def test_이름과_하이퍼파라미터가_변형마다_구분된다(world):
    names = {f: LightGCN(f).name for f in ("none", "chart", "chart+meta")}
    assert names == {
        "none": "M5_lightgcn",
        "chart": "M5_lightgcn_feat",
        "chart+meta": "M5_lightgcn_feat_meta",
    }
    params = LightGCN("chart", dim=8, seed=9).params()
    assert (
        params["dim"] == 8
        and params["seed"] == 9
        and params["features"] == "chart"
        and params["cold_norm"] is True
    )
    with pytest.raises(ValueError):
        LightGCN("everything")


def test_합성_데이터에서_인기보다_일반_곡을_더_잘_맞힌다(world):
    """하니스 점검용이다. 합성 데이터의 점수는 모델의 실제 성능이 아니다."""
    data, split = world
    popularity = Popularity().fit(split.train, data, now=split.cutoff)
    model = fit(world, "none", epochs=30)
    report = evaluate([popularity, model], split, data, EvalConfig(k=10, bootstrap=50))
    assert (
        report.results[model.name].metrics["recall_warm"]
        > report.results[popularity.name].metrics["recall_warm"]
    )


# ------------------------------------------------------------------ 새 곡(콜드 스타트)


def test_특징_노드가_있으면_새_곡이_추천에_들어오고_없으면_들어오지_못한다(world):
    data, split = world
    plain, feat = fit(world, "none"), fit(world, "chart")
    cold = set(data.songs["song_id"]) - set(split.train["song_id"])
    assert cold
    users = list(split.cold_test["user_key"])[:60]

    def cold_share(model):
        tops = [model.rank(u, 10, exclude=model.seen_songs(u)) for u in users]
        return sum(s in cold for top in tops for s in top) / (10 * len(users))

    assert cold_share(feat) > 0.01 and cold_share(feat) > 3 * cold_share(plain)


def test_새_곡_크기_보정은_방향을_바꾸지_않고_크기만_맞춘다(world):
    data, split = world
    on, off = fit(world, "chart", cold_norm=True), fit(world, "chart", cold_norm=False)
    known = np.zeros(len(on.song_ids), dtype=bool)
    known[on.graph.known_songs] = True
    norm_on, norm_off = (
        np.linalg.norm(on.song_block, axis=1),
        np.linalg.norm(off.song_block, axis=1),
    )
    assert np.allclose(norm_on[~known], norm_on[known].mean())
    assert np.allclose(norm_on[known], norm_off[known])  # 학습된 곡은 그대로
    cos = (on.song_block[~known] * off.song_block[~known]).sum(axis=1) / (
        norm_on[~known] * norm_off[~known]
    )
    assert np.allclose(cos, 1.0)  # 방향은 같다
    # 특징이 없는 변형에는 쓰지 않는다
    none = fit(world, "none", cold_norm=True)
    assert np.allclose(
        none.song_block, none.final[none.graph.n_users : none.graph.n_users + none.graph.n_songs]
    )


# ------------------------------------------------------------------ 민감도


def test_순위_안정성은_같은_설정이면_1이고_시드가_다르면_낮아진다(world):
    _, split = world
    a, b, c = fit(world, "chart", seed=1), fit(world, "chart", seed=1), fit(world, "chart", seed=2)
    users = list(split.warm_test["user_key"])[:80]
    same = ranking_stability(a, b, users, k=10)
    assert same["jaccard"] == 1.0 and same["spearman"] == pytest.approx(1.0)
    other = ranking_stability(a, c, users, k=10)
    assert 0.2 < other["jaccard"] < 1.0 and other["n_users"] == len(users)


# ------------------------------------------------------------------ 하이퍼파라미터 선택(시험 누수 방지)


def test_검증_분할은_학습_구간만으로_만들고_시험_구간을_보지_않는다(world):
    from ssaplash_ai.recommend.tuning import validation_split

    _, split = world
    inner = validation_split(split.train)
    assert inner.train["played_at"].max() < inner.cutoff < split.cutoff
    for part in (inner.train, inner.warm_test, inner.cold_test):
        assert (
            part["played_at"] < split.cutoff
        ).all()  # 시험 구간(cutoff 이후)의 연주는 하나도 없다


def test_tune은_검증_Recall이_가장_높은_설정을_고르고_표를_남긴다(world):
    from ssaplash_ai.recommend.tuning import tune

    data, split = world
    candidates = [{"reg": 1e-4}, {"reg": 3e-3}, {"reg": 3e-2}]
    result = tune(lambda p: LightGCN("none", epochs=12, dim=16, **p), candidates, split.train, data)
    assert result.best in candidates
    assert len(result.table) == 3 and result.n_targets > 0
    assert result.table["validation_recall"].idxmax() == candidates.index(result.best)
    assert (result.table["validation_recall"].between(0, 1)).all()


def test_tune은_후보가_없으면_거부한다(world):
    from ssaplash_ai.recommend.tuning import tune

    data, split = world
    with pytest.raises(ValueError):
        tune(lambda p: LightGCN("none", **p), [], split.train, data)
