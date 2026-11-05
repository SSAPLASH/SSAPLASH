"""기준선 M0~M3의 공통 인터페이스, 누수 방지, 방법별 성질(설계 문서 부록 B.6·B.10)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ssaplash_ai.recommend.data import load_dataset, temporal_split
from ssaplash_ai.recommend.models import CoPlay, Popularity, R1Rules, SimilarToRecent
from ssaplash_ai.recommend.models.base import build_histories
from ssaplash_ai.recommend.simulate import SimConfig, generate

MODELS = (Popularity, R1Rules, SimilarToRecent, CoPlay)


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    synthetic = generate(SimConfig(seed=5, n_songs=120, n_users=500, mean_plays=22))
    root = synthetic.write(Path(tmp_path_factory.mktemp("baselines")) / "data")
    ds = load_dataset(root, "P0")
    split = temporal_split(ds.interactions)
    fitted = {cls: cls().fit(split.train, ds, now=split.cutoff) for cls in MODELS}
    return synthetic, ds, split, fitted


def targets(split):
    return pd.concat([split.warm_test, split.cold_test])


@pytest.fixture(params=MODELS, ids=lambda c: c.__name__)
def model(request, world):
    return world[3][request.param]


# ------------------------------------------------------------------ 공통 인터페이스


def test_순위는_k개이고_곡이_겹치지_않으며_모두_공용_곡이다(model, world):
    _, ds, split, _ = world
    songs = set(ds.songs["song_id"])
    for user in list(targets(split)["user_key"])[:25]:
        top = model.rank(user, 10)
        assert len(top) == 10 and len(set(top)) == 10 and set(top) <= songs


def test_같은_입력은_같은_순위를_돌려준다(model, world):
    user = world[2].warm_test["user_key"].iloc[0]
    assert model.rank(user, 10) == model.rank(user, 10)


def test_제외한_곡은_순위에_나오지_않는다(model, world):
    split = world[2]
    for user in list(split.warm_test["user_key"])[:25]:
        blocked = model.seen_songs(user)
        assert blocked and not blocked & set(model.rank(user, 10, exclude=blocked))


def test_k가_1보다_작으면_거부한다(model):
    with pytest.raises(ValueError):
        model.rank("synth-user-000000", 0)


def test_학습_구간에_없는_사용자는_인기_순서로_대체한다(world):
    popular = world[3][Popularity].rank("ghost-user-0001", 10)
    for cls in MODELS:
        assert world[3][cls].rank("ghost-user-0001", 10) == popular


def test_학습_구간이_비면_거부한다(world):
    _, ds, split, _ = world
    with pytest.raises(ValueError, match="비어"):
        Popularity().fit(split.train.iloc[0:0], ds)


# ------------------------------------------------------------------ 누수 방지


def test_학습은_학습_구간_연주만_본다(world):
    _, ds, split, fitted = world
    counts = split.train.groupby("song_id").size()
    expected = np.array([counts.get(int(s), 0) for s in fitted[Popularity].song_ids], dtype=float)
    assert np.array_equal(fitted[Popularity].popularity_counts, expected)
    assert fitted[Popularity].now == split.cutoff


def test_시험_구간의_연주는_학습_이력에_없다(world):
    _, _, split, fitted = world
    histories = build_histories(split.train)
    for history in histories.values():
        assert all(t < split.cutoff for t in history.played_at)
    assert fitted[CoPlay].histories.keys() == histories.keys()


def test_이력은_입력_순서와_무관하게_시간순이다(world):
    _, _, split, _ = world
    shuffled = split.train.sample(frac=1, random_state=1)
    a, b = build_histories(split.train), build_histories(shuffled)
    assert a.keys() == b.keys() and all(a[u] == b[u] for u in list(a)[:50])


# ------------------------------------------------------------------ 방법별 성질


def test_M0은_연주_수_순서이고_같으면_곡_id순이다(world):
    m = world[3][Popularity]
    top = m.rank("ghost-user-0001", 20)
    counts = dict(zip(m.song_ids.tolist(), m.popularity_counts.tolist(), strict=True))
    keys = [(-counts[s], s) for s in top]
    assert keys == sorted(keys)


def test_연주_기록만_쓰는_M0과_M3은_새_곡을_순위에_올리지_못한다(world):
    _, ds, split, fitted = world
    new_songs = set(split.cold_test["song_id"])
    assert new_songs
    for cls in (Popularity, CoPlay):
        m = fitted[cls]
        for user in list(split.cold_test["user_key"])[:20]:
            assert not new_songs & set(m.rank(user, 10, exclude=m.seen_songs(user)))


def test_특징을_쓰는_M2는_새_곡에도_점수를_준다(world):
    _, _, split, fitted = world
    m = fitted[SimilarToRecent]
    new_index = [m.song_index[s] for s in set(split.cold_test["song_id"])]
    user = split.cold_test["user_key"].iloc[0]
    assert m.scores(user)[new_index].max() > 0


def test_M1은_기준_밀도의_1점5배를_넘는_채보를_추천하지_않는다(world):
    _, _, split, fitted = world
    m = fitted[R1Rules]
    from ssaplash_ai.recommend import r1

    checked = 0
    for user in list(split.warm_test["user_key"])[:60]:
        profile = r1.build_profile(m._plays[user], m.density_of, m.pads_of, m.now)
        if profile.baseline_density is None:
            continue
        for scored in r1.rank(m.candidates, profile, m.now, 10):
            assert scored.candidate.density / profile.baseline_density <= r1.HARD_LIMIT
            checked += 1
    assert checked > 100


def test_M3은_자기_자신과의_동시_연주를_점수에_쓰지_않는다(world):
    m = world[3][CoPlay]
    assert (np.diag(m.cosine) == 0).all()
    assert (m.cosine >= 0).all() and (m.cosine <= 1.0 + 1e-9).all()


def test_M2의_곡_순서는_모델과_유사도_행렬에서_같다(world):
    m = world[3][SimilarToRecent]
    assert np.array_equal(m.similarity.song_ids, m.song_ids)


# ------------------------------------------------------------------ 합성 데이터에서의 건전성


def test_모든_기준선은_합성_데이터에서_무작위보다_잘_맞힌다(world):
    """하니스 점검용이다. 합성 데이터의 점수는 모델의 실제 성능이 아니다."""
    _, ds, split, fitted = world
    random_recall = 10 / len(ds.songs)
    test = split.warm_test[~split.warm_test["repeat"]]
    for cls in MODELS:
        m = fitted[cls]
        hits = sum(
            r.song_id in m.rank(r.user_key, 10, exclude=m.seen_songs(r.user_key))
            for r in test.itertuples()
        )
        assert hits / len(test) > 1.5 * random_recall, cls.__name__
