"""진입 판단 보고서(`report.py`, 설계 문서 부록 B.7·B.10 작업 8)."""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from ssaplash_ai.recommend.data import load_dataset, temporal_split
from ssaplash_ai.recommend.evaluate import EvalConfig, evaluate
from ssaplash_ai.recommend.models import CoPlay, Popularity, R1Rules, Recommender, SimilarToRecent
from ssaplash_ai.recommend.report import (
    CONTINUE,
    HARNESS_ONLY,
    INSUFFICIENT_DATA,
    STOP,
    DecisionConfig,
    decide,
    to_markdown,
)
from ssaplash_ai.recommend.run import main
from ssaplash_ai.recommend.simulate import SimConfig, generate


class Oracle(Recommender):
    """정답을 1위에 놓는 시험용 후보(이름이 M5로 시작해 후보로 취급된다)."""

    def __init__(self, name, targets, safe=True):
        self.name, self.targets, self.safe = name, targets, safe

    def rank(self, user_key, k, exclude=()):
        blocked = set(exclude)
        fill = [
            int(s)
            for s in self.song_ids
            if int(s) != self.targets.get(user_key) and int(s) not in blocked
        ]
        top = ([self.targets[user_key]] if user_key in self.targets else []) + fill
        return top[:k]


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    synthetic = generate(SimConfig(seed=23, n_songs=100, n_users=400, mean_plays=22))
    data = load_dataset(synthetic.write(Path(tmp_path_factory.mktemp("report")) / "data"), "P0")
    split = temporal_split(data.interactions)
    targets = {r.user_key: r.song_id for r in split.warm_test.itertuples()} | {
        r.user_key: r.song_id for r in split.cold_test.itertuples()
    }
    baselines = [
        cls().fit(split.train, data, now=split.cutoff)
        for cls in (Popularity, R1Rules, SimilarToRecent, CoPlay)
    ]
    oracle = Oracle("M5_oracle", targets).fit(split.train, data, now=split.cutoff)
    pool = Oracle("M5_pool", {}).fit(split.train, data, now=split.cutoff)  # 정답을 모르는 후보
    report = evaluate(baselines + [oracle, pool], split, data, EvalConfig(k=10, bootstrap=100))
    return report


def as_stage(report, stage):
    return dataclasses.replace(report, stage=stage)


LOW = DecisionConfig(min_warm_targets=1, min_cold_targets=1)


def test_합성_데이터는_점수가_좋아도_판단하지_않는다(world):
    decision = decide(world, LOW)
    assert world.stage == "P0" and decision.verdict == HARNESS_ONLY
    assert any("실제 성능이 아니다" in r for r in decision.reasons)
    assert decision.gates["M5_oracle"]["checks"]["warm_ndcg_gain"][
        "passed"
    ]  # 게이트 결과 자체는 참고용으로 남는다


def test_시험_표본이_기준보다_적으면_기준을_넘어도_판단_보류다(world):
    report = as_stage(world, "P1")
    decision = decide(report, DecisionConfig(min_warm_targets=10_000, min_cold_targets=10_000))
    assert decision.verdict == INSUFFICIENT_DATA
    assert any("일반 시험 목표" in r for r in decision.reasons) and any(
        "새 곡 시험 목표" in r for r in decision.reasons
    )


def test_표본이_충분하고_후보가_기준을_넘으면_계속이다(world):
    from ssaplash_ai.recommend.evaluate import GateConfig

    cfg = DecisionConfig(
        1, 1, GateConfig(max_violation_rate=1.0)
    )  # 정답 후보는 안전성을 모르므로 이 시험에서는 풀어 둔다
    decision = decide(as_stage(world, "P1"), cfg)
    assert decision.verdict == CONTINUE and "M5_oracle" in decision.reasons[0]
    assert decision.gates["M5_pool"]["passed"] is False


def test_표본이_충분한데_기준을_넘는_후보가_없으면_중단_권고다(world):
    stripped = dataclasses.replace(
        as_stage(world, "P1"), results={n: r for n, r in world.results.items() if n != "M5_oracle"}
    )
    decision = decide(stripped, LOW)
    assert decision.verdict == STOP and any(
        "M5_pool" in r and "탈락 항목" in r for r in decision.reasons
    )


def test_기준선이나_후보가_없으면_거부한다(world):
    only_baselines = dataclasses.replace(
        world, results={n: r for n, r in world.results.items() if n.startswith("M0")}
    )
    with pytest.raises(ValueError, match="기준선"):
        decide(only_baselines, LOW)


def test_보고서에는_권고와_진입_판단표와_주의가_있고_개인_값은_없다(world):
    decision = decide(world, LOW)
    text = to_markdown(world, decision, LOW)
    for section in (
        "## 권고",
        "## 데이터",
        "## 방법별 결과",
        "## 진입 판단",
        "## 해석할 때 주의",
        "## 재현 정보",
    ):
        assert section in text
    assert "판단하지 않음(합성 데이터)" in text and "M5_oracle: " in text
    assert "synth-user" not in text and "user_key" not in text
    assert f"해시 {world.digest()[:12]}" in text
    assert "합성 데이터의 점수는 모델의 실제 성능이 아니다" in text
    assert to_markdown(world, decision, LOW) == text  # 같은 입력은 같은 보고서


def test_실행기가_보고서를_쓴다(tmp_path: Path, capsys):
    path = tmp_path / "report.md"
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
            "20",
            "--models",
            "M0,M1,M2,M3,M5",
            "--report",
            str(path),
        ]
    )
    assert code == 0
    text = path.read_text(encoding="utf-8")
    assert "# 곡 추천 R3 PoC 결과 보고서" in text and "M5_lightgcn" in text
    assert "진입 판단: 판단하지 않음(합성 데이터)" in capsys.readouterr().out


def test_기준선이_빠진_실행은_보고서에서_오류_코드_2다(tmp_path: Path, capsys):
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
            "M0",
            "--report",
            str(tmp_path / "r.md"),
        ]
    )
    assert (
        code == 2 and "보고서 오류" in capsys.readouterr().err and not (tmp_path / "r.md").exists()
    )
