"""MLflow 기록과 "다시 돌릴지" 판단.

기록 규약(설계 3.4)
- 실험 이름 `coach-weak-segments-calibration`, run 이름 `calib-{날짜}-n{유효 세션 수}`.
- 태그 `approval`: `pending`(제안한 후보가 있어 사람의 승인을 기다림) / `approved` / `rejected` / `superseded`(새 실행으로 대체됨) /
  `NOT_APPLICABLE`(제안한 후보가 없어 승인할 것이 없음). `approved`·`rejected`는 사람이 MLflow에서 직접 바꾼다.
- 태그 `sampleStatus`(`OK`/`INSUFFICIENT_SAMPLE`), 파라미터 `dataMaxDate`·`viewSessionCount`가 다음 실행의 기준이 된다.
  `--since`·`--mode`로 일부만 고른 실행은 기준에서 뺀다(`viewSessionCount`는 전체 수라서 정기 실행을 막게 된다).
- **행 단위 데이터를 올리지 않는다.** 지표와 산출물은 집계값이며 작은 셀(5개 미만)은 가려진 값만 쓴다.

임계값을 자동으로 바꾸는 코드는 없다. 이 모듈은 기록만 한다.
"""

from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EXPERIMENT_NAME = "coach-weak-segments-calibration"
DEFAULT_TRACKING_URI = "mlruns"

APPROVAL_PENDING = "pending"
APPROVAL_SUPERSEDED = "superseded"
APPROVAL_NOT_APPLICABLE = "NOT_APPLICABLE"

# 실행 판단 이유(로그와 기록에 그대로 쓴다)
RUN_FIRST = "FIRST_RUN"
RUN_GROWTH = "ENOUGH_NEW_SESSIONS"
SKIP_NOT_ENOUGH = "NOT_ENOUGH_NEW_SESSIONS"
RUN_FORCED = "FORCED"  # 정책을 바꾼 뒤 등, 사람이 새 세션과 상관없이 돌리라고 한 경우

# 기준 실행을 찾을 때 볼 최근 실행 수. 일부만 고른 실행이 그 앞에 쌓여 있어도 찾을 수 있게 넉넉히 둔다
LAST_RUN_SEARCH = 100


def resolve_tracking_uri(uri: str | None = None) -> str:
    """주소를 정한다. 환경 변수 `MLFLOW_TRACKING_URI`가 있으면 그 값, 없으면 로컬 `mlruns/`(파일 저장소)."""
    chosen = uri or os.environ.get("MLFLOW_TRACKING_URI") or DEFAULT_TRACKING_URI
    if "://" in chosen or chosen.startswith("file:"):
        if chosen.startswith("file:"):
            os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
        return chosen
    os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
    return Path(chosen).resolve().as_uri()


@dataclass(frozen=True)
class LastRun:
    run_id: str
    data_max_date: str | None
    view_session_count: int


@dataclass(frozen=True)
class RunDecision:
    run: bool
    reason: str
    new_sessions: int
    decreased: bool = False  # 지난번보다 세션이 줄었다(동의 철회 등). 기록에 남기기 위한 표시


def decide(last: LastRun | None, view_session_count: int, min_new: int) -> RunDecision:
    """지난 성공 실행 이후 새로 쌓인 세션이 `min_new` 이상이면 다시 돈다.

    BE가 "어제 있던 세션이 오늘 없을 수 있다"(동의 철회 등)고 알려 줬다. 개수만 비교하므로 줄어든 만큼은
    새로 쌓인 세션이 가려져 실행이 조금 늦어질 수 있다. 늦어질 뿐 잘못 실행하지는 않는 쪽을 택했다.
    """
    if last is None:
        enough = view_session_count >= min_new
        return RunDecision(enough, RUN_FIRST if enough else SKIP_NOT_ENOUGH, view_session_count)
    grown = max(0, view_session_count - last.view_session_count)
    enough = grown >= min_new
    return RunDecision(
        enough,
        RUN_GROWTH if enough else SKIP_NOT_ENOUGH,
        grown,
        decreased=view_session_count < last.view_session_count,
    )


def _client(tracking_uri: str | None = None):
    from mlflow.tracking import MlflowClient

    return MlflowClient(tracking_uri=resolve_tracking_uri(tracking_uri))


def _experiment_id(client, create: bool) -> str | None:
    experiment = client.get_experiment_by_name(EXPERIMENT_NAME)
    if experiment is not None:
        return experiment.experiment_id
    return client.create_experiment(EXPERIMENT_NAME) if create else None


def find_last_run(tracking_uri: str | None = None) -> LastRun | None:
    """일부만 고른 실행을 뺀, 가장 최근에 정상 종료된 실행. 실험이 아직 없으면 None."""
    client = _client(tracking_uri)
    experiment_id = _experiment_id(client, create=False)
    if experiment_id is None:
        return None
    runs = client.search_runs(
        [experiment_id],
        filter_string="attributes.status = 'FINISHED'",
        order_by=["attributes.start_time DESC"],
        max_results=LAST_RUN_SEARCH,
    )
    run = next((r for r in runs if not _is_partial(r.data.params)), None)
    if run is None:
        return None
    params = run.data.params
    try:
        count = int(params["viewSessionCount"])
    except (KeyError, ValueError):
        return None
    return LastRun(run.info.run_id, params.get("dataMaxDate"), count)


def _is_partial(params: dict[str, str]) -> bool:
    """`--since`·`--mode`로 일부만 고른 실행인가. 두 파라미터가 없던 때의 실행은 전체 실행이다."""
    return bool(params.get("since")) or params.get("modes", "ALL") != "ALL"


def metrics_from_records(
    profiles: dict[str, dict[str, Any]], candidates: dict[str, Any]
) -> dict[str, float]:
    """가려진 기록(`to_record()`)에서 MLflow 지표로 쓸 수 있는 값만 꺼낸다. 가려진 값(None)은 건너뛴다."""
    out: dict[str, float] = {}

    def put(name: str, value: Any) -> None:
        if isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value):
            out[name] = float(value)

    for group, record in profiles.items():
        put(f"sessions/{group}", record["nSessions"])
        put(f"notes/{group}", record["nNotes"])
        put(f"meanSegments/{group}", record["meanSegments"])
        put(f"flagRate/{group}/ANY", record["anyFlag"]["rate"])
        for pattern, fr in record["flagRates"].items():
            put(f"flagRate/{group}/{pattern}", fr["rate"])
        for name, dist in record["distributions"].items():
            if dist["masked"]:
                continue
            for key, value in dist.items():
                if key.startswith("q"):
                    put(f"dist/{group}/{name}/{key}", value)
    for group, record in candidates.get("groups", {}).items():
        put(f"current/{group}", record["current"]["rate"])
        put(f"threshold/{group}", record["currentValue"])
        if record["candidateValue"] is not None:
            put(f"candidateThreshold/{group}", record["candidateValue"])
            put(f"candidateRate/{group}", record["candidate"]["rate"])
    return out


def record_run(
    *,
    run_name: str,
    params: dict[str, Any],
    tags: dict[str, str],
    metrics: dict[str, float],
    artifacts: list[Path],
    tracking_uri: str | None = None,
    supersede_pending: bool = True,
) -> str:
    """실행 1건을 기록한다. 이전의 `pending` 실행은 `superseded`로 바꾼다. MLflow run id를 돌려준다."""
    from mlflow.entities import Metric, Param, RunTag

    client = _client(tracking_uri)
    experiment_id = _experiment_id(client, create=True)
    run = client.create_run(experiment_id, run_name=run_name)
    run_id = run.info.run_id
    now = int(time.time() * 1000)
    try:
        client.log_batch(
            run_id,
            metrics=[Metric(k, v, now, 0) for k, v in sorted(metrics.items())],
            params=[Param(k, str(v)) for k, v in sorted(params.items())],
            tags=[RunTag(k, str(v)) for k, v in sorted(tags.items())],
        )
        for path in artifacts:
            if Path(path).is_file():
                client.log_artifact(run_id, str(path))
    except Exception:
        client.set_terminated(run_id, "FAILED")
        raise
    client.set_terminated(run_id, "FINISHED")

    if supersede_pending:
        old = client.search_runs(
            [experiment_id], filter_string=f"tags.approval = '{APPROVAL_PENDING}'", max_results=100
        )
        for r in old:
            if r.info.run_id != run_id:
                client.set_tag(r.info.run_id, "approval", APPROVAL_SUPERSEDED)
    return run_id
