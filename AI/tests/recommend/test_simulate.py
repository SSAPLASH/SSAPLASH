"""합성 생성기(설계 문서 부록 B.4, 인수 조건 B.10). 점수의 의미가 아니라 생성기가 약속한 성질을 확인한다."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd
import pytest

from ssaplash_ai.recommend.data import DataError, load_dataset, temporal_split
from ssaplash_ai.recommend.simulate import PRACTICE_SONGS, SimConfig, generate

CONFIG = SimConfig(seed=3, n_songs=60, n_users=600, mean_plays=20)


@pytest.fixture(scope="module")
def synthetic():
    return generate(CONFIG)


def digest(frame: pd.DataFrame) -> str:
    return hashlib.sha256(frame.to_csv(index=False).encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ 재현성


def test_같은_시드는_같은_데이터를_만들고_다른_시드는_다르다(synthetic):
    again = generate(CONFIG)
    for name in ("users", "songs", "chart_features", "interactions", "song_meta", "weak_summary"):
        assert digest(getattr(again, name)) == digest(getattr(synthetic, name)), name
    other = generate(SimConfig(seed=4, n_songs=60, n_users=600, mean_plays=20))
    assert digest(other.interactions) != digest(synthetic.interactions)


def test_숨은_값도_시드가_같으면_같다(synthetic):
    again = generate(CONFIG)
    assert again.truth.user_skill == synthetic.truth.user_skill
    assert again.truth.new_song_release == synthetic.truth.new_song_release
    assert again.truth.user_affinity.equals(synthetic.truth.user_affinity)


# ------------------------------------------------------------------ 스키마


def test_만든_폴더는_로더를_그대로_통과한다(synthetic, tmp_path: Path):
    root = synthetic.write(tmp_path / "synthetic")
    ds = load_dataset(root, "P0")
    assert ds.summary()["users"] == 600 and ds.summary()["songs"] == 60
    assert ds.summary()["interactions"] == len(synthetic.interactions)
    assert ds.songs["song_level"].isin(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).all()
    assert (ds.users["consent_version"] == "synthetic").all()


def test_가짜_사용자_키는_로더의_가명_규칙을_지킨다(synthetic):
    keys = synthetic.users["user_key"]
    assert keys.is_unique and keys.str.fullmatch(r"synth-user-\d{6}").all()


def test_연습_패턴_3곡은_처음부터_있고_장르가_PRACTICE이다(synthetic):
    practice = synthetic.song_meta[synthetic.song_meta["genre"] == "PRACTICE"]
    assert list(practice["song_id"]) == [1, 2, 3] and len(practice) == len(PRACTICE_SONGS)
    assert not set(range(1, 4)) & set(synthetic.truth.new_song_release)


def test_일부_채보는_격자가_제외_표시이고_모든_곡에_NORMAL_채보가_있다(synthetic):
    grids = synthetic.chart_features["rhythm_grid"].map(json.loads)
    assert any("excluded" in g for g in grids) and any("groups" in g for g in grids)
    normal_songs = set(
        synthetic.chart_features.loc[synthetic.chart_features["difficulty"] == "NORMAL", "song_id"]
    )
    assert normal_songs == set(synthetic.songs["song_id"])


def test_채보_특징의_비율은_0에서_1이고_격자_묶음은_12칸이다(synthetic):
    for text in synthetic.chart_features["pad_ratio"]:
        assert all(0 <= v <= 1 for v in json.loads(text).values())
    for text in synthetic.chart_features["rhythm_grid"]:
        grid = json.loads(text)
        for bins in grid.get("groups", {}).values():
            assert len(bins) == 12 and (abs(sum(bins) - 1) < 1e-3 or sum(bins) == 0)


# ------------------------------------------------------------------ 새 곡과 시간


def test_새_곡은_열리기_전에는_연주되지_않는다(synthetic):
    releases = synthetic.truth.new_song_release
    assert releases
    played = pd.to_datetime(synthetic.interactions["played_at"], utc=True)
    for song_id, release in releases.items():
        times = played[synthetic.interactions["song_id"] == song_id]
        assert times.empty or times.min() >= release


def test_시간순_분할하면_새_곡이_cold_시험으로_간다(synthetic):
    interactions = load_dataset_from(synthetic)
    split = temporal_split(interactions)
    assert len(split.cold_test) >= 3
    new = set(synthetic.truth.new_song_release)
    assert split.cold_test["song_id"].isin(new).mean() >= 0.8
    # 새 곡은 학습에 한 번도 나오지 않는다
    assert not set(split.train["song_id"]) & new


def load_dataset_from(synthetic) -> pd.DataFrame:
    frame = synthetic.interactions.copy()
    frame["played_at"] = pd.to_datetime(frame["played_at"], utc=True)
    return frame


# ------------------------------------------------------------------ 심어 둔 취향과 실력


def test_사용자는_취향_장르를_더_자주_친다(synthetic):
    plays = synthetic.interactions.assign(
        genre=lambda d: d["song_id"].map(synthetic.truth.song_genre)
    )
    affinity = synthetic.truth.user_affinity
    top = plays["user_key"].map(affinity.idxmax(axis=1))
    bottom = plays["user_key"].map(affinity.idxmin(axis=1))
    share_top, share_bottom = (plays["genre"] == top).mean(), (plays["genre"] == bottom).mean()
    assert share_top > 0.3 and share_top > 5 * share_bottom


def test_실력에_맞는_채보를_주로_치고_너무_어려우면_정확도가_떨어진다(synthetic):
    plays = synthetic.interactions.assign(
        ratio=lambda d: (
            d["chart_id"].map(synthetic.truth.chart_density)
            / d["user_key"].map(synthetic.truth.user_skill)
        )
    )
    assert 0.9 < plays["ratio"].median() < 1.5
    assert (plays["ratio"] > 1.5).mean() < 0.25
    easy = plays.loc[plays["ratio"] < 1.0, "accuracy"].mean()
    hard = plays.loc[plays["ratio"] > 1.4, "accuracy"].mean()
    assert easy - hard > 15


def test_완주_표시는_정확도가_낮으면_거짓이다(synthetic):
    assert not synthetic.interactions.loc[
        synthetic.interactions["accuracy"] < 50, "completed"
    ].any()
    assert synthetic.interactions["completed"].mean() > 0.7


def test_이미_친_곡을_다시_치는_연주가_있다(synthetic):
    pairs = synthetic.interactions.groupby(["user_key", "song_id"]).size()
    assert (pairs > 1).mean() > 0.02


# ------------------------------------------------------------------ 설정 검증


def test_잘못된_설정은_거부한다():
    with pytest.raises(ValueError):
        generate(SimConfig(n_songs=3))
    with pytest.raises(ValueError):
        generate(SimConfig(n_users=0))


def test_분할_도구는_합성_데이터가_아니라_로더_결과도_받는다(synthetic, tmp_path: Path):
    ds = load_dataset(synthetic.write(tmp_path / "s"), "P0")
    assert len(temporal_split(ds.interactions).train) > 0
    with pytest.raises(DataError):
        load_dataset(tmp_path / "missing", "P0")
