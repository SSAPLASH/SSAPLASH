"""보정 실행 끝에서 끝까지: 뷰 모사 → 제외 → 분포 → 후보 → MLflow 기록, 그리고 다시 돌릴지 판단."""

from __future__ import annotations

import json

import pytest
from mlflow.tracking import MlflowClient

from calibration_helpers import late_gradient_rows, synthetic_request, view_rows
from ssaplash_ai.coach_calibration import register
from ssaplash_ai.coach_calibration.pipeline import STATUS_OK, STATUS_SKIPPED, run_calibration
from ssaplash_ai.coach_calibration.policy import Policy
from ssaplash_ai.coach_calibration.register import (
    EXPERIMENT_NAME,
    LastRun,
    decide,
    metrics_from_records,
    resolve_tracking_uri,
)
from ssaplash_ai.coach_calibration.source import ALLOWED_COLUMNS, DisallowedColumnError, ListSource
from ssaplash_ai.coach_eval.runner import RunConfig

FAST_REEVAL = RunConfig(seeds=3, note_counts=(60,), good_ms_values=(50.0,))
TARGETS = Policy(targets={"TIMING": (0.30, 0.40)})


@pytest.fixture
def uri(tmp_path, monkeypatch):
    monkeypatch.setenv("MLFLOW_ALLOW_FILE_STORE", "true")
    return (tmp_path / "mlruns").as_uri()


def _client(uri: str) -> MlflowClient:
    return MlflowClient(tracking_uri=uri)


def _runs(uri: str):
    client = _client(uri)
    experiment = client.get_experiment_by_name(EXPERIMENT_NAME)
    return [] if experiment is None else client.search_runs([experiment.experiment_id])


def _run(rows, uri, policy=TARGETS, **kwargs):
    return run_calibration(
        ListSource(rows, columns=ALLOWED_COLUMNS),
        policy,
        tracking_uri=uri,
        reeval_config=FAST_REEVAL,
        today="2026-10-30",
        **kwargs,
    )


# --- 다시 돌릴지 판단(순수 함수) ---


def test_first_run_needs_at_least_min_new_sessions():
    assert decide(None, 49, 50).run is False
    first = decide(None, 50, 50)
    assert first.run and first.reason == register.RUN_FIRST and first.new_sessions == 50


def test_later_runs_need_min_new_sessions_since_the_last_one():
    last = LastRun("r", "2026-10-29", 100)

    assert decide(last, 149, 50).run is False
    grown = decide(last, 150, 50)
    assert grown.run and grown.reason == register.RUN_GROWTH and grown.new_sessions == 50


def test_fewer_sessions_than_before_does_not_trigger_and_is_flagged():
    last = LastRun("r", "2026-10-29", 100)

    decision = decide(last, 80, 50)

    assert not decision.run and decision.decreased and decision.new_sessions == 0


def test_masked_values_are_not_turned_into_metrics():
    record = {
        "DRUM": {
            "nSessions": 60,
            "nNotes": 100,
            "meanSegments": 0.5,
            "anyFlag": {"rate": 0.4},
            "flagRates": {"TIMING_LATE": {"rate": None}, "PAD_LATE": {"rate": 0.1}},
            "distributions": {
                "missRate": {"masked": True, "nSessions": None},
                "deltaNorm": {"masked": False, "nSessions": 60, "q50": 0.1},
            },
        }
    }

    metrics = metrics_from_records(record, {"groups": {}})

    assert "flagRate/DRUM/TIMING_LATE" not in metrics
    assert metrics["flagRate/DRUM/PAD_LATE"] == 0.1
    assert "dist/DRUM/missRate/q50" not in metrics and metrics["dist/DRUM/deltaNorm/q50"] == 0.1


def test_tracking_uri_defaults_to_a_local_folder(monkeypatch, tmp_path):
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    monkeypatch.chdir(tmp_path)

    assert resolve_tracking_uri().startswith("file:") and resolve_tracking_uri().endswith("/mlruns")
    assert resolve_tracking_uri("http://mlflow:5000") == "http://mlflow:5000"
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "http://other:5000")
    assert resolve_tracking_uri() == "http://other:5000"


# --- 끝에서 끝까지 ---


def test_first_run_records_a_pending_candidate_with_summary_artifacts(uri, tmp_path):
    rows = late_gradient_rows(60)

    outcome = _run(rows, uri)

    assert outcome.status == STATUS_OK and outcome.candidates >= 1
    assert outcome.approval == "pending" and outcome.valid_sessions == 60
    (run,) = _runs(uri)
    assert run.info.run_name == "calib-2026-10-30-n60"
    assert run.data.tags["approval"] == "pending"
    assert run.data.tags["sampleStatus"] == "OK"
    assert run.data.params["viewSessionCount"] == "60"
    assert run.data.params["dataMaxDate"] == "2026-10-29"
    assert "flagRate/DRUM/TIMING_LATE" in run.data.metrics
    assert "reeval/worstRecallDrop" in run.data.metrics
    assert run.data.metrics["excluded/TOO_FEW_NOTES"] == 0.0  # 0건인 이유도 기록된다

    client = _client(uri)
    names = {a.path for a in client.list_artifacts(run.info.run_id)}
    assert {"summary.md", "profile.json", "candidates.json", "reeval.json"} <= names
    for name in names:
        path = client.download_artifacts(run.info.run_id, name, str(tmp_path / "dl"))
        text = open(path, encoding="utf-8").read()
        assert "sess000" not in text and "session_key" not in text  # 세션 키가 없다
        assert '"t_ms"' not in text  # 행 단위 데이터가 없다
    summary = open(
        client.download_artifacts(run.info.run_id, "summary.md", str(tmp_path / "dl2")),
        encoding="utf-8",
    ).read()
    assert "승인 절차" in summary and "`approval`" in summary


def test_run_without_policy_targets_records_distribution_only(uri):
    outcome = _run(late_gradient_rows(60), uri, policy=Policy())

    assert outcome.status == STATUS_OK and outcome.candidates == 0
    assert outcome.approval == "NOT_APPLICABLE"
    (run,) = _runs(uri)
    assert run.data.tags["approval"] == "NOT_APPLICABLE"
    assert "reeval/worstRecallDrop" not in run.data.metrics  # 후보가 없으면 재평가도 없다
    names = {a.path for a in _client(uri).list_artifacts(run.info.run_id)}
    assert "reeval.json" not in names and "candidates.json" in names


def test_nothing_new_means_skipped_and_no_new_run(uri):
    rows = late_gradient_rows(60)
    _run(rows, uri)

    again = _run(rows, uri)

    assert again.status == STATUS_SKIPPED and again.reason == register.SKIP_NOT_ENOUGH
    assert len(_runs(uri)) == 1


def test_enough_new_sessions_runs_again_and_supersedes_the_pending_run(uri):
    _run(late_gradient_rows(60), uri)

    second = _run(late_gradient_rows(110), uri)  # 50개가 더 쌓였다

    assert second.status == STATUS_OK and second.reason == register.RUN_GROWTH
    runs = sorted(_runs(uri), key=lambda r: r.info.start_time)
    assert [r.data.tags["approval"] for r in runs] == ["superseded", "pending"]


def test_first_run_with_too_few_sessions_is_skipped_without_creating_anything(uri):
    outcome = _run(late_gradient_rows(30), uri)

    assert outcome.status == STATUS_SKIPPED
    assert _client(uri).get_experiment_by_name(EXPERIMENT_NAME) is None


def test_enough_sessions_but_too_few_valid_ones_records_insufficient_sample(uri):
    rows = []
    for i in range(55):  # 노트 10개짜리 세션뿐이라 모두 제외된다
        rows += view_rows(synthetic_request(i, n_notes=10), session_key=f"short{i:03d}")

    outcome = _run(rows, uri)

    assert outcome.status == STATUS_OK and outcome.sample_status == "INSUFFICIENT_SAMPLE"
    assert outcome.valid_sessions == 0 and outcome.approval == "NOT_APPLICABLE"
    (run,) = _runs(uri)
    assert run.data.tags["sampleStatus"] == "INSUFFICIENT_SAMPLE"
    assert run.data.metrics["excluded/TOO_FEW_NOTES"] == 55.0


def test_disallowed_column_fails_before_anything_is_recorded(uri):
    rows = late_gradient_rows(60)
    for row in rows:
        row["user_id"] = 7

    with pytest.raises(DisallowedColumnError):
        run_calibration(ListSource(rows), TARGETS, tracking_uri=uri)

    assert _client(uri).get_experiment_by_name(EXPERIMENT_NAME) is None


def test_run_records_the_policy_and_thresholds_it_used(uri):
    _run(late_gradient_rows(60), uri)

    (run,) = _runs(uri)

    assert json.loads(run.data.params["policyTargets"]) == {"TIMING": [0.3, 0.4]}
    assert json.loads(run.data.params["thresholds"])["timing_mean_ratio"] == 0.3


def test_force_runs_even_without_new_sessions_and_records_the_reason(uri):
    rows = late_gradient_rows(60)
    _run(rows, uri, policy=Policy())  # 정책 없이 첫 실행(후보 없음)

    skipped = _run(rows, uri, policy=TARGETS)
    forced = _run(rows, uri, policy=TARGETS, force=True)  # 정책을 채운 뒤 다시 돌린다

    assert skipped.status == STATUS_SKIPPED
    assert forced.status == STATUS_OK and forced.reason == register.RUN_FORCED
    assert forced.candidates >= 1 and forced.approval == "pending"
    runs = sorted(_runs(uri), key=lambda r: r.info.start_time)
    assert [r.data.tags["runDecision"] for r in runs] == [register.RUN_FIRST, register.RUN_FORCED]


def test_force_does_not_run_on_an_empty_view(uri):
    outcome = run_calibration(
        ListSource([], columns=ALLOWED_COLUMNS), TARGETS, tracking_uri=uri, force=True
    )

    assert outcome.status == STATUS_SKIPPED
    assert _client(uri).get_experiment_by_name(EXPERIMENT_NAME) is None
