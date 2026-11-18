"""실험 설정 검증·등록(FE `coach/live/models/experiment.ts`와 같은 형식)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ssaplash_ai.coach_live_model.experiment import (
    ConfigError,
    load_config,
    main,
    register_config,
    validate_config,
)

GOOD = {
    "gate": {
        "mode": "shadow",
        "arms": [
            {"model": "coach-gate-mlp16", "share": 50},
            {"model": "coach-gate-logistic", "share": 50},
        ],
    },
    "cause": {"arms": []},
    "rolloutPercent": 100,
}
EXAMPLE = Path(__file__).parents[2] / "configs" / "coach" / "coach_live_config.json"


LLM_OFF = {"mode": "off", "rolloutPercent": 0}


def test_valid_config_is_normalised() -> None:
    assert validate_config(GOOD) == {**GOOD, "llm": LLM_OFF}
    assert validate_config({**GOOD, "cause": None})["cause"] == {"arms": []}


@pytest.mark.parametrize(
    "bad",
    [
        {**GOOD, "gate": {**GOOD["gate"], "mode": "maybe"}},
        {**GOOD, "gate": {"mode": "on", "arms": [{"model": "coach-gate-mlp16", "share": 60}]}},
        {**GOOD, "gate": {"mode": "on", "arms": [{"model": "../x", "share": 100}]}},
        {**GOOD, "gate": {"mode": "on", "arms": []}},
        {**GOOD, "rolloutPercent": 101},
        {"rolloutPercent": 1},
    ],
)
def test_invalid_config_is_rejected(bad: dict) -> None:
    with pytest.raises(ConfigError):
        validate_config(bad)


def test_llm_is_kept_for_publishing() -> None:
    # 등록본에서 llm이 빠지면 FE가 off로 보고 연주 중 LLM 실험군을 배정하지 않는다
    llm = {"mode": "shadow", "rolloutPercent": 100}
    assert validate_config({**GOOD, "llm": llm})["llm"] == llm
    # 없으면 FE parseLlm처럼 꺼짐으로 남긴다
    assert validate_config(GOOD)["llm"] == LLM_OFF


@pytest.mark.parametrize(
    "llm",
    [
        "shadow",
        {"mode": "maybe", "rolloutPercent": 100},
        {"mode": "on"},
        {"mode": "on", "rolloutPercent": 101},
        {"mode": "on", "rolloutPercent": True},
    ],
)
def test_invalid_llm_is_rejected(llm: object) -> None:
    with pytest.raises(ConfigError):
        validate_config({**GOOD, "llm": llm})


def test_off_needs_no_arms() -> None:
    assert validate_config({"gate": {"mode": "off"}, "rolloutPercent": 0})["gate"]["arms"] == []


def test_example_config_is_valid() -> None:
    assert load_config(EXAMPLE)["gate"]["mode"] == "on"


def test_example_config_keeps_llm() -> None:
    # 예시 설정의 llm이 등록 결과에 그대로 남는다
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    assert raw["llm"] == {"mode": "on", "rolloutPercent": 100}
    assert load_config(EXAMPLE)["llm"] == raw["llm"]


def test_register_checks_arm_models_and_creates_versions(tmp_path: Path) -> None:
    import mlflow

    uri = (tmp_path / "mlruns").as_uri()
    path = tmp_path / "config.json"
    path.write_text(json.dumps(GOOD), encoding="utf-8")
    # 실험군 모델이 레지스트리에 없으면 거절한다
    with pytest.raises(ConfigError):
        register_config(path, uri)
    assert register_config(path, uri, check_models=False) == "1"

    got = mlflow.artifacts.download_artifacts(
        artifact_uri="models:/coach-live-config/1", dst_path=str(tmp_path / "dl")
    )
    files = sorted(p.name for p in Path(got).rglob("*") if p.is_file())
    assert files == ["config.json"]
    assert json.loads((Path(got) / "config.json").read_text(encoding="utf-8")) == {
        **GOOD,
        "llm": LLM_OFF,
    }


def test_cli_reports_config_errors(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "bad.json"
    path.write_text("{", encoding="utf-8")
    assert main(["check", str(path)]) == 2
    assert "설정 오류" in capsys.readouterr().out
    assert main(["check", str(EXAMPLE)]) == 0
