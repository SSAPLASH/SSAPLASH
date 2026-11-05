"""M6 후보 + 규칙 재정렬(설계 문서 부록 B.6)."""

from __future__ import annotations

from pathlib import Path

import pytest

from ssaplash_ai.recommend import r1
from ssaplash_ai.recommend.data import load_dataset, temporal_split
from ssaplash_ai.recommend.evaluate import EvalConfig, evaluate
from ssaplash_ai.recommend.models import LightGCN, Popularity, Recommender, Reranked
from ssaplash_ai.recommend.run import main
from ssaplash_ai.recommend.simulate import SimConfig, generate
from ssaplash_ai.recommend.tuning import tune


class Order(Recommender):
    """주어진 곡 순서를 그대로 돌려주는 후보 생성기(시험용). 이미 친 곡은 뺀다."""

    name = "M5_order"

    def __init__(self, order_fn):
        self.order_fn = order_fn

    def rank(self, user_key, k, exclude=()):
        blocked = set(exclude)
        return [s for s in self.order_fn(self) if s not in blocked][:k]


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    synthetic = generate(SimConfig(seed=17, n_songs=100, n_users=400, mean_plays=22))
    data = load_dataset(synthetic.write(Path(tmp_path_factory.mktemp("rerank")) / "data"), "P0")
    split = temporal_split(data.interactions)
    return data, split


def songs_by_density(model, descending):
    charts = model.data.chart_features.groupby("song_id")["avg_notes_per_sec"].min()
    return [int(s) for s in charts.sort_values(ascending=not descending).index]


def baseline_of(model, user):
    return r1.build_profile(
        model._plays[user], model.density_of, model.pads_of, model.now
    ).baseline_density


def make(world, order_fn, **kw):
    data, split = world
    return Reranked(Order(order_fn), **kw).fit(split.train, data, now=split.cutoff)


# ------------------------------------------------------------------ 하드 제외


def test_기준_밀도를_아는_사용자에게는_1점5배를_넘는_곡을_추천하지_않는다(world):
    data, split = world
    model = make(
        world, lambda m: songs_by_density(m, descending=True)
    )  # 일부러 어려운 곡부터 내놓는 후보
    min_density = data.chart_features.groupby("song_id")["avg_notes_per_sec"].min().to_dict()
    checked = 0
    for user in list(split.warm_test["user_key"])[:80]:
        base = baseline_of(model, user)
        if base is None:
            continue
        top = model.rank(user, 10, exclude=model.seen_songs(user))
        assert top and all(min_density[s] / base <= r1.HARD_LIMIT for s in top)
        checked += 1
    assert checked > 20


def test_위반율은_후보_생성기보다_낮고_실제_모델에서_0이다(world):
    data, split = world
    generator = LightGCN("chart", epochs=15, dim=16).fit(split.train, data, now=split.cutoff)
    reranked = Reranked(LightGCN("chart", epochs=15, dim=16))
    reranked.fit(split.train, data, now=split.cutoff)
    report = evaluate([generator, reranked], split, data, EvalConfig(k=10, bootstrap=30))
    rate = {n: r.metrics["violation_rate"] for n, r in report.results.items()}
    assert rate[generator.name] > 0 and rate[reranked.name] == 0.0


# ------------------------------------------------------------------ 순서와 우회


def test_가중치_1이면_후보_순서를_지키고_하드_제외만_한다(world):
    data, split = world
    order = lambda m: songs_by_density(m, descending=True)  # noqa: E731
    model = make(world, order, relevance_weight=1.0)
    safe_checked = 0
    for user in list(split.warm_test["user_key"])[:60]:
        base = baseline_of(model, user)
        if base is None:
            continue
        candidates = [s for s in order(model) if s not in model.seen_songs(user)]
        min_density = data.chart_features.groupby("song_id")["avg_notes_per_sec"].min().to_dict()
        expected = [s for s in candidates if min_density[s] / base <= r1.HARD_LIMIT][:10]
        assert model.rank(user, 10, exclude=model.seen_songs(user)) == expected
        safe_checked += 1
    assert safe_checked > 10


def test_가중치_0이면_순서가_규칙_점수_순서다(world):
    model = make(
        world,
        lambda m: songs_by_density(m, descending=False),
        relevance_weight=0.0,
        candidate_k=100,
    )
    user = next(u for u in model._plays if baseline_of(model, u) is not None)
    profile = r1.build_profile(model._plays[user], model.density_of, model.pads_of, model.now)
    ordered = [s for s in songs_by_density(model, False) if s not in model.seen_songs(user)]
    best = r1.score_songs([c for s in ordered for c in model.charts_of[s]], profile, model.now)
    expected = [s for s in sorted(best, key=lambda s: (-best[s].total, ordered.index(s)))][:10]
    assert model.rank(user, 10, exclude=model.seen_songs(user)) == expected


def test_기준_밀도를_모르는_사용자는_후보_순서_그대로다(world):
    data, split = world
    order = lambda m: songs_by_density(m, descending=True)  # noqa: E731
    model = make(world, order)
    no_baseline = [u for u in model._plays if baseline_of(model, u) is None]
    assert no_baseline
    for user in no_baseline[:10]:
        assert model.rank(user, 10, exclude=model.seen_songs(user)) == model.generator.rank(
            user, 10, model.seen_songs(user)
        )


def test_학습_구간에_없는_사용자는_후보_생성기의_대체_순위를_쓴다(world):
    data, split = world
    popularity = Popularity()
    model = Reranked(popularity).fit(split.train, data, now=split.cutoff)
    assert model.rank("ghost-user-0001", 10) == popularity.rank("ghost-user-0001", 10)


def test_후보가_모두_위험하면_풀을_전체_곡까지_넓혀_안전한_곡을_찾는다(world):
    # 앞쪽 후보 5개는 가장 어려운 곡이라 모두 빠진다. 안전한 곡은 뒤에 있다.
    model = make(
        world, lambda m: songs_by_density(m, descending=True), candidate_k=5, relevance_weight=1.0
    )
    user = next(u for u in model._plays if baseline_of(model, u) is not None)
    top = model.rank(user, 5, exclude=model.seen_songs(user))
    assert len(top) == 5


def test_안전한_곡이_없으면_모자란_대로_돌려주고_위험한_곡으로_채우지_않는다(world, monkeypatch):
    model = make(world, lambda m: songs_by_density(m, descending=False))
    user = next(u for u in model._plays if baseline_of(model, u) is not None)
    monkeypatch.setattr(r1, "HARD_LIMIT", 0.01)  # 어떤 채보도 한도 안에 못 든다
    assert model.rank(user, 10, exclude=model.seen_songs(user)) == []


# ------------------------------------------------------------------ 설정


def test_설정_값을_검증하고_이름과_하이퍼파라미터를_남긴다(world):
    with pytest.raises(ValueError):
        Reranked(LightGCN("chart"), candidate_k=0)
    with pytest.raises(ValueError):
        Reranked(LightGCN("chart"), relevance_weight=1.5)
    model = Reranked(LightGCN("chart", dim=8), candidate_k=30, relevance_weight=0.25)
    assert model.name == "M6_rerank_lightgcn_feat"
    params = model.params()
    assert (
        params["candidate_k"] == 30
        and params["relevance_weight"] == 0.25
        and params["generator.dim"] == 8
    )
    assert params["generator"] == "M5_lightgcn_feat"
    with pytest.raises(ValueError):
        make(world, lambda m: songs_by_density(m, True)).rank("synth-user-000000", 0)


def test_가중치는_검증_구간으로_고를_수_있다(world):
    data, split = world
    candidates = [{"relevance_weight": 0.0}, {"relevance_weight": 0.75}, {"relevance_weight": 1.0}]
    result = tune(
        lambda p: Reranked(LightGCN("none", epochs=10, dim=16), **p), candidates, split.train, data
    )
    assert result.best in candidates and len(result.table) == 3


def test_실행기에서_M6를_고를_수_있다(tmp_path: Path):
    out = tmp_path / "out"
    code = main(
        [
            "--synthetic",
            "--stage",
            "P0",
            "--synthetic-users",
            "150",
            "--synthetic-songs",
            "50",
            "--bootstrap",
            "20",
            "--models",
            "M0,M6",
            "--out",
            str(out),
        ]
    )
    assert code == 0
    import json

    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert "M6_rerank_lightgcn" in report["models"]
    assert report["params"]["M6_rerank_lightgcn"]["relevance_weight"] == 0.75
