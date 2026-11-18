"""브라우저가 받을 모델 파일을 MLflow에 기록하고 레지스트리에 새 버전으로 등록한다(거름·원인 모델 공용).

모델 폴더에는 `files`만 넣는다. 서버의 게시 도구(`publish-model`)가 `models:/이름/버전` 폴더를 그대로 `/models`로
복사하기 때문이다. 보고서는 실행(run)의 산출물로만 남긴다. 게시는 서버에서 따로 한다.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any


def register_model_files(
    out: Path,
    files: Sequence[str],
    *,
    experiment: str,
    model_name: str,
    run_name: str,
    params: dict[str, Any],
    metrics: dict[str, float],
    tags: dict[str, str],
    report_file: str | None = None,
    tracking_uri: str | None = None,
) -> str:
    """등록한 레지스트리 버전을 돌려준다. 파일이 하나라도 없으면 FileNotFoundError."""
    os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
    import mlflow
    from mlflow import MlflowClient
    from mlflow.exceptions import MlflowException

    from ssaplash_ai.coach_calibration.register import resolve_tracking_uri

    missing = [n for n in files if not (out / n).is_file()]
    if missing:
        raise FileNotFoundError(f"등록할 파일이 없습니다: {', '.join(missing)}")
    uri = resolve_tracking_uri(tracking_uri)
    mlflow.set_tracking_uri(uri)
    mlflow.set_registry_uri(uri)
    mlflow.set_experiment(experiment)

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        mlflow.set_tags(tags)
        if report_file and (out / report_file).is_file():
            mlflow.log_artifact(str(out / report_file))
        with tempfile.TemporaryDirectory() as tmp:
            for name in files:
                (Path(tmp) / name).write_bytes((out / name).read_bytes())
            mlflow.log_artifacts(tmp, artifact_path="model")
        source = mlflow.get_artifact_uri("model")

    client = MlflowClient()
    try:
        client.create_registered_model(model_name)
    except MlflowException as e:
        if e.error_code != "RESOURCE_ALREADY_EXISTS":
            raise
    version = client.create_model_version(model_name, source, run.info.run_id, tags=tags)
    return str(version.version)
