"""실시간 코칭 실험 설정(`coach-live-config`)을 검증해 MLflow 레지스트리에 등록한다(설계 COACH-001 3.4, R3·R4).

실험 설정은 모델처럼 게시해서 버전 관리와 롤백을 그대로 쓴다. 형식은 FE `coach/live/models/experiment.ts`와 같다.

```
uv run python -m ssaplash_ai.coach_live_model.experiment check configs/coach/coach_live_config.json
MLFLOW_TRACKING_URI=http://localhost:5000 uv run python -m ssaplash_ai.coach_live_model.experiment register configs/coach/coach_live_config.json
# 서버에서: docker compose -p infra exec mlflow publish-model publish coach-live-config <버전>
```
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

CONFIG_MODEL_NAME = "coach-live-config"
CONFIG_FILE = "config.json"
EXPERIMENT_NAME = "coach-live-config"
MODES = ("off", "shadow", "on")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


class ConfigError(ValueError):
    pass


def _arms(x: Any, where: str) -> list[dict[str, Any]]:
    if x is None:
        return []
    if not isinstance(x, list):
        raise ConfigError(f"{where}는 목록이어야 합니다")
    arms = []
    for a in x:
        if (
            not isinstance(a, dict)
            or not isinstance(a.get("model"), str)
            or not NAME_RE.match(a["model"])
        ):
            raise ConfigError(
                f"{where}의 model은 게시 이름 규칙(영문 소문자·숫자·.-_)을 따라야 합니다"
            )
        share = a.get("share")
        if not isinstance(share, int) or isinstance(share, bool) or not 0 <= share <= 100:
            raise ConfigError(f"{where}의 share는 0~100 정수여야 합니다")
        arms.append({"model": a["model"], "share": share})
    if arms and sum(a["share"] for a in arms) != 100:
        raise ConfigError(f"{where}의 share 합이 100이어야 합니다")
    return arms


def validate_config(x: Any) -> dict[str, Any]:
    """FE가 받아들이는 형식인지 본다. 틀리면 ConfigError(FE는 틀린 설정을 없는 것으로 본다)."""
    if not isinstance(x, dict) or not isinstance(x.get("gate"), dict):
        raise ConfigError("gate가 없습니다")
    mode = x["gate"].get("mode")
    if mode not in MODES:
        raise ConfigError(f"gate.mode는 {', '.join(MODES)} 중 하나여야 합니다")
    gate_arms = _arms(x["gate"].get("arms"), "gate.arms")
    cause = x.get("cause")
    cause_arms = _arms(cause.get("arms") if isinstance(cause, dict) else None, "cause.arms")
    rollout = x.get("rolloutPercent")
    if (
        not isinstance(rollout, (int, float))
        or isinstance(rollout, bool)
        or not 0 <= rollout <= 100
    ):
        raise ConfigError("rolloutPercent는 0~100이어야 합니다")
    if mode != "off" and not gate_arms:
        raise ConfigError("gate.mode가 off가 아니면 gate.arms가 있어야 합니다")
    # llm을 빼면 FE가 꺼짐으로 읽어 연주 중 LLM 실험군을 배정하지 않는다. 등록본에 항상 남긴다
    return {
        "gate": {"mode": mode, "arms": gate_arms},
        "cause": {"arms": cause_arms},
        "rolloutPercent": rollout,
        "llm": _llm(x.get("llm")),
    }


def _llm(x: Any) -> dict[str, Any]:
    """연주 중 LLM 구간 코칭 설정(FE `parseLlm`과 같은 규칙). 없으면 꺼짐, 틀리면 ConfigError."""
    if x is None:
        return {"mode": "off", "rolloutPercent": 0}
    if not isinstance(x, dict):
        raise ConfigError("llm은 객체여야 합니다")
    mode = x.get("mode")
    if mode not in MODES:
        raise ConfigError(f"llm.mode는 {', '.join(MODES)} 중 하나여야 합니다")
    rollout = x.get("rolloutPercent")
    if (
        not isinstance(rollout, (int, float))
        or isinstance(rollout, bool)
        or not 0 <= rollout <= 100
    ):
        raise ConfigError("llm.rolloutPercent는 0~100이어야 합니다")
    return {"mode": mode, "rolloutPercent": rollout}


def load_config(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ConfigError(f"JSON이 아닙니다: {e}") from e
    return validate_config(raw)


def register_config(path: Path, tracking_uri: str | None = None, check_models: bool = True) -> str:
    """설정 파일을 레지스트리 모델 `coach-live-config`의 새 버전으로 등록한다. 등록한 버전을 돌려준다.

    check_models면 실험군 모델이 레지스트리에 있는지 확인한다(게시 여부는 서버에서 `publish-model list`로 본다).
    """
    os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
    import mlflow
    from mlflow import MlflowClient
    from mlflow.exceptions import MlflowException

    from ssaplash_ai.coach_calibration.register import resolve_tracking_uri

    config = load_config(path)
    uri = resolve_tracking_uri(tracking_uri)
    mlflow.set_tracking_uri(uri)
    mlflow.set_registry_uri(uri)
    client = MlflowClient()
    if check_models:
        for arm in config["gate"]["arms"] + config["cause"]["arms"]:
            try:
                client.get_registered_model(arm["model"])
            except MlflowException as e:
                raise ConfigError(f"레지스트리에 없는 모델입니다: {arm['model']}") from e

    mlflow.set_experiment(EXPERIMENT_NAME)
    with mlflow.start_run(run_name=f"config-{config['gate']['mode']}") as run:
        mlflow.log_params(
            {
                "gateMode": config["gate"]["mode"],
                "rolloutPercent": config["rolloutPercent"],
                "gateArms": ",".join(f"{a['model']}:{a['share']}" for a in config["gate"]["arms"]),
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / CONFIG_FILE).write_text(
                json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            mlflow.log_artifacts(tmp, artifact_path="model")
        source = mlflow.get_artifact_uri("model")
    try:
        client.create_registered_model(CONFIG_MODEL_NAME)
    except MlflowException as e:
        if e.error_code != "RESOURCE_ALREADY_EXISTS":
            raise
    version = client.create_model_version(CONFIG_MODEL_NAME, source, run.info.run_id)
    return str(version.version)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="실시간 코칭 실험 설정 검증·등록")
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("check", help="형식만 검사한다")
    c.add_argument("file", type=Path)
    r = sub.add_parser("register", help="검사하고 MLflow 레지스트리에 등록한다")
    r.add_argument("file", type=Path)
    r.add_argument("--tracking-uri")
    r.add_argument(
        "--skip-model-check",
        action="store_true",
        help="실험군 모델의 레지스트리 존재 확인을 건너뛴다",
    )
    args = p.parse_args(argv)
    try:
        if args.command == "check":
            config = load_config(args.file)
            llm = config["llm"]
            print(
                f"형식 맞음: mode={config['gate']['mode']} rollout={config['rolloutPercent']} "
                f"llm={llm['mode']} {llm['rolloutPercent']}%"
            )
            return 0
        version = register_config(args.file, args.tracking_uri, not args.skip_model_check)
    except ConfigError as e:
        print(f"설정 오류: {e}")
        return 2
    print(f"MLflow 등록: {CONFIG_MODEL_NAME} 버전 {version}")
    print(
        f"게시(서버): docker compose -p infra exec mlflow publish-model publish {CONFIG_MODEL_NAME} {version}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
