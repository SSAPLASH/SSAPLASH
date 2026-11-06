"""평가 하니스(설계 문서 부록 B.7·B.10): 지표 계산, 신뢰구간, 비교, 진입 판단, 재현성, 개인 값 비기록, MLflow."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pytest

from ssaplash_ai.recommend.data import load_dataset, temporal_split
from ssaplash_ai.recommend.evaluate import (
    EvalConfig,
    GateConfig,
    compare,
    entry_gate,
    evaluate,
    user_baselines,
)
from ssaplash_ai.recommend.models import CoPlay, Popularity, R1Rules, Recommender, SimilarToRecent
from ssaplash_ai.recommend.run import main
from ssaplash_ai.recommend.simulate import SimConfig, generate

K = 5


class Stub(Recommender):
    """정해진 규칙으로 순위를 돌려주는 시험용 방법."""

    def __init__(self, name, fn):
        self.name = name
        self.fn = fn

    def rank(self, user_key, k, exclude=()):
        return self.fn(self, user_key, k, set(exclude))


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    synthetic = generate(SimConfig(seed=7, n_songs=100, n_users=400, mean_plays=22))
    root = synthetic.write(Path(tmp_path_factory.mktemp("evaluate")) / "data")
    data = load_dataset(root, "P0")
    split = temporal_split(data.interactions)
    real = [
        cls().fit(split.train, data, now=split.cutoff)
        for cls in (Popularity, R1Rules, SimilarToRecent, CoPlay)
    ]
    target_of = {
        r.user_key: r.song_id for r in pd.concat([split.warm_test, split.cold_test]).itertuples()
    }
    return data, split, real, target_of


def stub(world, name, fn):
    data, split, _, _ = world
    return Stub(name, fn).fit(split.train, data, now=split.cutoff)


def oracle_at(world, position):
    """정답 곡을 순위 `position`(0부터)에 놓고 나머지는 곡 id 순으로 채운다."""
    target_of = world[3]

    def rank(self, user, k, exclude):
        fill = [
            int(s) for s in self.song_ids if int(s) != target_of[user] and int(s) not in exclude
        ]
        top = fill[:position] + [target_of[user]] + fill[position:]
        return top[:k]

    return stub(world, f"oracle@{position}", rank)


def report_of(world, models, **cfg):
    data, split, _, _ = world
    return evaluate(models, split, data, EvalConfig(k=K, bootstrap=200, **cfg))


# ------------------------------------------------------------------ 지표 계산


def test_정답을_1위에_놓으면_Recall과_NDCG가_1이다(world):
    m = report_of(world, [oracle_at(world, 0)]).results["oracle@0"].metrics
    assert m["recall_warm"] == 1.0 and m["ndcg_warm"] == 1.0
    assert m["recall_cold"] == 1.0 and m["ndcg_cold"] == 1.0


def test_정답이_3위면_NDCG는_1_나누기_log2_4이다(world):
    m = report_of(world, [oracle_at(world, 2)]).results["oracle@2"].metrics
    assert m["recall_warm"] == 1.0
    assert m["ndcg_warm"] == pytest.approx(1 / math.log2(4)) and m["ndcg_cold"] == pytest.approx(
        0.5
    )


def test_정답이_k_밖이면_적중하지_않는다(world):
    m = report_of(world, [oracle_at(world, K)]).results[f"oracle@{K}"].metrics
    assert m["recall_warm"] == 0.0 and m["ndcg_warm"] == 0.0 and m["recall_cold"] == 0.0


def test_커버리지는_추천에_나온_서로_다른_곡_비율이다(world):
    constant = stub(world, "constant", lambda self, u, k, ex: [int(s) for s in self.song_ids[:k]])
    r = report_of(world, [constant])
    assert r.results["constant"].metrics["coverage"] == pytest.approx(K / r.n_songs)


def test_새_곡_비중은_추천_중_학습_구간에_없던_곡의_비율이다(world):
    data, split, _, _ = world
    cold = sorted(set(data.songs["song_id"]) - set(split.train["song_id"]))
    assert len(cold) >= K
    only_cold = stub(world, "cold", lambda self, u, k, ex: cold[:k])
    only_warm = stub(
        world,
        "warm",
        lambda self, u, k, ex: [s for s in map(int, self.song_ids) if s not in cold][:k],
    )
    r = report_of(world, [only_cold, only_warm])
    assert r.results["cold"].metrics["cold_item_share"] == 1.0
    assert r.results["warm"].metrics["cold_item_share"] == 0.0


def test_하드_제외_위반율은_기준_밀도_1점5배를_넘는_곡의_비율이다(world):
    data, split, real, _ = world
    densest = (
        data.chart_features.groupby("song_id")["avg_notes_per_sec"]
        .min()
        .sort_values(ascending=False)
        .index.tolist()
    )
    risky = stub(world, "risky", lambda self, u, k, ex: [int(s) for s in densest[:k]])
    r = report_of(world, [risky] + real)
    risky_rate = r.results["risky"].metrics["violation_rate"]
    assert risky_rate > 0.3
    assert r.results["M1_r1_rules"].metrics["violation_rate"] < risky_rate / 3
    assert r.results["risky"].metrics["violation_checked_items"] > 0


def test_사용자_기준_밀도는_최근_10판_중_85퍼센트_이상인_판의_최대_밀도다():
    train = pd.DataFrame(
        {
            "user_key": ["a"] * 3 + ["b"] * 2,
            "chart_id": [1, 2, 3, 1, 2],
            "accuracy": [90.0, 70.0, 88.0, 50.0, 60.0],
            "played_at": pd.to_datetime(
                ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-01", "2026-10-02"], utc=True
            ),
        }
    )
    base = user_baselines(train, {1: 2.0, 2: 3.0, 3: 5.0})
    assert base == {"a": 5.0, "b": None}


def test_다양성은_목록_안의_곡_난이도와_장르_종류_수다(world):
    r = report_of(world, [world[2][0]])
    m = r.results["M0_popularity"].metrics
    assert 1 <= m["diversity_levels"] <= 3 and 1 <= m["diversity_genres"] <= K


# ------------------------------------------------------------------ 반복 목표·입력 보호


def test_이미_친_곡을_다시_친_목표는_기본으로_평가에서_뺀다(world):
    data, split, real, _ = world
    popularity = real[0]
    with_repeat = evaluate(
        [popularity], split, data, EvalConfig(k=K, bootstrap=50, exclude_repeat_targets=False)
    )
    without = evaluate([popularity], split, data, EvalConfig(k=K, bootstrap=50))
    n_repeat = int(split.warm_test["repeat"].sum())
    assert n_repeat > 0
    assert (
        with_repeat.results[popularity.name].metrics["n_warm"]
        == without.results[popularity.name].metrics["n_warm"] + n_repeat
    )
    # 이미 친 곡은 순위에서 빼므로 반복 목표는 맞힐 수 없다
    assert (
        with_repeat.results[popularity.name].metrics["recall_warm"]
        <= without.results[popularity.name].metrics["recall_warm"]
    )


def test_평가는_입력_분할을_바꾸지_않는다(world):
    data, split, real, _ = world
    before = [f.copy() for f in (split.train, split.warm_test, split.cold_test)]
    evaluate(real, split, data, EvalConfig(k=K, bootstrap=50))
    for a, b in zip(before, (split.train, split.warm_test, split.cold_test), strict=True):
        assert a.equals(b)


def test_이름이_겹치거나_k가_잘못되면_거부한다(world):
    data, split, real, _ = world
    with pytest.raises(ValueError, match="겹칩니다"):
        evaluate([real[0], real[0]], split, data)
    with pytest.raises(ValueError):
        evaluate(real, split, data, EvalConfig(k=0))


# ------------------------------------------------------------------ 신뢰구간과 비교


def test_신뢰구간은_평균을_포함하고_시드가_같으면_같다(world):
    a = report_of(world, [world[2][0]])
    b = report_of(world, [world[2][0]])
    m = a.results["M0_popularity"].metrics
    for metric in ("recall_warm", "ndcg_warm", "recall_cold", "ndcg_cold"):
        assert m[f"{metric}_ci_low"] <= m[metric] <= m[f"{metric}_ci_high"]
    assert a.results["M0_popularity"].metrics == b.results["M0_popularity"].metrics


def test_짝_비교는_상대_개선과_신뢰구간을_준다(world):
    r = report_of(world, [oracle_at(world, 0), world[2][0]])
    c = compare(r, "oracle@0", "M0_popularity")
    assert (
        c["relative"] > 1
        and c["ci_low"] > 0
        and c["n"] == r.results["M0_popularity"].metrics["n_warm"]
    )
    same = compare(r, "M0_popularity", "M0_popularity")
    assert same["relative"] == 0 and same["ci_low"] == 0 and same["ci_high"] == 0


# ------------------------------------------------------------------ 진입 판단


def test_정답을_맞히는_후보는_성능_기준을_통과한다(world):
    r = report_of(world, [oracle_at(world, 0)] + world[2])
    gate = entry_gate(
        r,
        "oracle@0",
        ["M0_popularity", "M1_r1_rules", "M2_similar_to_recent", "M3_coplay"],
        cold_reference="M2_similar_to_recent",
        cfg=GateConfig(max_violation_rate=1.0),
    )
    assert gate["checks"]["warm_ndcg_gain"]["passed"] and gate["checks"]["cold_recall"]["passed"]
    assert gate["passed"]


def test_기준선과_같은_후보는_개선_기준을_넘지_못한다(world):
    r = report_of(world, world[2])
    gate = entry_gate(
        r, "M0_popularity", ["M0_popularity", "M3_coplay"], cold_reference="M2_similar_to_recent"
    )
    assert not gate["passed"] and not gate["checks"]["warm_ndcg_gain"]["passed"]
    assert gate["checks"]["warm_ndcg_gain"]["best_baseline"] in ("M0_popularity", "M3_coplay")


def test_하드_제외_위반이_많으면_안전성에서_탈락한다(world):
    data = world[0]
    densest = (
        data.chart_features.groupby("song_id")["avg_notes_per_sec"]
        .min()
        .sort_values(ascending=False)
        .index.tolist()
    )
    risky = stub(world, "risky", lambda self, u, k, ex: [int(s) for s in densest[:k]])
    r = report_of(world, [risky, world[2][0]])
    gate = entry_gate(r, "risky", ["M0_popularity"], cold_reference="M0_popularity")
    assert not gate["checks"]["violation_rate"]["passed"]


# ------------------------------------------------------------------ 재현성과 개인 값


def test_같은_입력과_시드는_같은_보고서를_만든다(world):
    data, split, _, _ = world
    models = [
        cls().fit(split.train, data, now=split.cutoff) for cls in (Popularity, SimilarToRecent)
    ]
    a = evaluate(models, split, data, EvalConfig(k=K, bootstrap=100, seed=3))
    b = evaluate(models, split, data, EvalConfig(k=K, bootstrap=100, seed=3))
    c = evaluate(models, split, data, EvalConfig(k=K, bootstrap=100, seed=4))
    assert a.digest() == b.digest() != c.digest()


def test_보고서_요약에는_사용자_키와_개인_단위_값이_없다(world):
    r = report_of(world, world[2])
    text = json.dumps(r.to_dict(), ensure_ascii=False)
    assert "synth-user" not in text and "user_key" not in text
    assert r.to_dict()["stage"] == "P0" and r.to_dict()["data_hash"] == world[0].data_hash
    json.loads(text)  # NaN이 아니라 null로 직렬화된다


# ------------------------------------------------------------------ MLflow


def test_MLflow에_방법마다_run이_남고_집계_값만_기록된다(world, tmp_path: Path):
    mlflow = pytest.importorskip("mlflow")
    from ssaplash_ai.recommend.mlflow_log import log_report

    r = report_of(world, world[2][:2])
    uri = str(tmp_path / "mlruns")
    ids = log_report(
        r, tracking_uri=uri, experiment="song-recommend-test", stamp="20261105T000000Z"
    )
    assert len(ids) == 2
    client = mlflow.tracking.MlflowClient(tracking_uri=Path(uri).as_uri())
    for run_id, name in zip(ids, r.results, strict=True):
        run = client.get_run(run_id)
        assert run.data.params["stage"] == "P0" and run.data.params["dataHash"] == r.data_hash
        assert run.data.params["seed"] == "0" and run.data.params["model"] == name
        assert run.data.tags["gitCommit"] and run.data.tags["stage"] == "P0"
        assert (
            f"{name}/ndcg_warm" in run.data.metrics and f"{name}/violation_rate" in run.data.metrics
        )
        flat = json.dumps({**run.data.params, **run.data.tags, **run.data.metrics}, default=str)
        assert "synth-user" not in flat
        artifacts = client.list_artifacts(run_id)
        assert [a.path for a in artifacts] == ["report.json"]


# ------------------------------------------------------------------ 실행기


def test_실행기는_합성_데이터로_돌고_보고서를_쓴다(tmp_path: Path, capsys):
    out = tmp_path / "out"
    code = main(
        [
            "--synthetic",
            "--stage",
            "P0",
            "--synthetic-users",
            "200",
            "--synthetic-songs",
            "60",
            "--bootstrap",
            "50",
            "--out",
            str(out),
        ]
    )
    assert code == 0
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    # 방법이 추가돼도 깨지지 않도록 "포함"만 확인한다
    assert report["stage"] == "P0" and set(report["models"]) >= {
        "M0_popularity",
        "M1_r1_rules",
        "M2_similar_to_recent",
        "M3_coplay",
        "M5_lightgcn",
        "M5_lightgcn_feat",
        "M5_lightgcn_feat_meta",
        "M6_rerank_lightgcn",
    }
    # 하이퍼파라미터가 보고서에 남는다(LightGCN만)
    assert (
        report["params"]["M5_lightgcn_feat"]["features"] == "chart"
        and report["params"]["M0_popularity"] == {}
    )
    assert (out / "table.csv").is_file()
    assert "실제 성능이 아닙니다" in capsys.readouterr().out


def test_실행기는_출처_단계_규칙을_지킨다(tmp_path: Path, capsys):
    assert main(["--synthetic", "--stage", "P1"]) == 2  # 합성은 P0만
    data_dir = generate(SimConfig(seed=1, n_songs=40, n_users=80)).write(tmp_path / "d")
    assert main(["--data", str(data_dir), "--stage", "P2"]) == 2  # 승인 근거 없는 P2
    assert main(["--data", str(data_dir), "--stage", "P0", "--models", "M9"]) == 2
    assert "데이터 오류" in capsys.readouterr().err
    assert (
        main(
            [
                "--data",
                str(data_dir),
                "--stage",
                "P1",
                "--bootstrap",
                "20",
                "--models",
                "M0",
            ]
        )
        == 0
    )


def test_실행기는_MLflow에도_기록한다(tmp_path: Path):
    pytest.importorskip("mlflow")
    uri = str(tmp_path / "mlruns")
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
            "M0,M2",
            "--mlflow",
            "--tracking-uri",
            uri,
            "--experiment",
            "song-recommend-test",
        ]
    )
    assert code == 0
    import mlflow

    client = mlflow.tracking.MlflowClient(tracking_uri=Path(uri).as_uri())
    experiment = client.get_experiment_by_name("song-recommend-test")
    assert len(client.search_runs([experiment.experiment_id])) == 2
