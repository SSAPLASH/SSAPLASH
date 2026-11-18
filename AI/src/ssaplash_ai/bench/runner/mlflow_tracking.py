"""MLflow 기록. 실행 1회 = run 1개.

기본은 로컬 파일 모드(`mlruns/`). 환경 변수 MLFLOW_TRACKING_URI가 있으면 그 값이 기본.
MLflow 3.x는 파일 저장소를 기본 차단하므로 폴더 경로를 받으면 MLFLOW_ALLOW_FILE_STORE=true를 켬.

- 실험 이름: separation-bench, transcription-bench, chart-rules, adtof-finetune·adtof-eval. run 이름: runId
- 파라미터: dataset, models, device, gpuName, host, clip, nSongs, nModels, nErrors, nSkipped. 채보는 input·separator·rules.{키}도
- 태그: runId, 모델별 configHash. 지표: 모델별 요약값 `{model}/{열}`. -inf·nan은 건너뜀
- 이어하기로 여러 번 돌리면 마지막 실행의 run만 남음
"""

from __future__ import annotations

import math
import os
from collections.abc import Sequence
from pathlib import Path

EXPERIMENT_NAME = "separation-bench"
TRANSCRIPTION_EXPERIMENT = "transcription-bench"
DEFAULT_TRACKING_URI = "mlruns"


def default_tracking_uri() -> str:
    return os.environ.get("MLFLOW_TRACKING_URI") or DEFAULT_TRACKING_URI


def _as_uri(tracking_uri: str) -> str:
    """폴더 경로면 file: URI로 바꾸고 파일 저장소 사용을 허용. 그 외(http, sqlite 등)는 그대로."""
    if tracking_uri.startswith("file:") or "://" not in tracking_uri:
        os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
    if "://" in tracking_uri or tracking_uri.startswith("file:"):
        return tracking_uri
    return Path(tracking_uri).resolve().as_uri()


def log_run(
    run_id: str,
    params: dict[str, object],
    summary_metrics: dict[str, dict[str, float]],
    artifacts: Sequence[Path],
    tags: dict[str, str] | None = None,
    tracking_uri: str | None = None,
    experiment_name: str = EXPERIMENT_NAME,
    step_metrics: Sequence[tuple[int, dict[str, float]]] = (),
) -> str:
    """run 1개를 만들고 파라미터·모델별 지표·산출물을 기록. mlflow run id 반환.

    summary_metrics: {모델 이름: {열 이름: 값}}. 유한한 값만 기록.
    step_metrics: [(step, {지표 이름: 값}), ...]. 학습 에폭처럼 이력이 있는 지표 (유한한 값만).
    """
    import mlflow

    mlflow.set_tracking_uri(_as_uri(tracking_uri or default_tracking_uri()))
    mlflow.set_experiment(experiment_name)
    with mlflow.start_run(run_name=run_id) as run:
        mlflow.set_tag("runId", run_id)
        for k, v in (tags or {}).items():
            mlflow.set_tag(k, v)
        mlflow.log_params({k: str(v) for k, v in params.items()})
        metrics: dict[str, float] = {}
        for model, values in summary_metrics.items():
            for column, value in values.items():
                if _finite(value):
                    metrics[f"{model}/{column}"] = float(value)
        if metrics:
            mlflow.log_metrics(metrics)
        for step, values in step_metrics:
            finite = {k: float(v) for k, v in values.items() if _finite(v)}
            if finite:
                mlflow.log_metrics(finite, step=step)
        for path in artifacts:
            path = Path(path)
            if path.is_file():
                mlflow.log_artifact(str(path))
        return run.info.run_id


def _finite(value: object) -> bool:
    return isinstance(value, int | float) and math.isfinite(value)


def find_run(run_id: str, experiment_name: str, tracking_uri: str | None = None) -> str | None:
    """실험 안에서 runId 태그가 run_id인 MLflow run id. 실험이나 run이 없으면 None."""
    from mlflow.tracking import MlflowClient

    client = MlflowClient(tracking_uri=_as_uri(tracking_uri or default_tracking_uri()))
    exp = client.get_experiment_by_name(experiment_name)
    if exp is None:
        return None
    escaped = run_id.replace("'", "\\'")
    runs = client.search_runs(
        [exp.experiment_id], filter_string=f"tags.runId = '{escaped}'", max_results=1
    )
    return runs[0].info.run_id if runs else None
