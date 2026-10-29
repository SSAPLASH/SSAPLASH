"""평가 실행기·보고서: 같은 시드면 같은 결과, 출력 파일이 만들어지는지, MLflow에 기록되는지."""

from __future__ import annotations

import json

import pytest

from ssaplash_ai.coach_eval import report
from ssaplash_ai.coach_eval.cli import main
from ssaplash_ai.coach_eval.metrics import summarize, summarize_by
from ssaplash_ai.coach_eval.runner import (
    RunConfig,
    measure_performance,
    run_all,
    server_smoke,
)

SMALL = RunConfig(seeds=4, note_counts=(60, 120), good_ms_values=(30.0, 60.0, 150.0))


@pytest.fixture(scope="module")
def result():
    return run_all(SMALL)


def test_same_config_gives_same_trials(result):
    again = run_all(SMALL)
    assert [t for t in again.trials] == [t for t in result.trials]


def test_other_base_seed_changes_trials(result):
    other = run_all(RunConfig(**{**SMALL.__dict__, "base_seed": 5}))
    assert other.trials != result.trials


def test_trial_count_is_scenarios_times_strengths_times_seeds(result):
    # 약점 9종 × 강도 4단계 + 정상 3종 × 1단계 = 39칸
    assert len(result.trials) == 39 * SMALL.seeds
    assert len(summarize(result.trials)) == 39


def test_trials_carry_conditions_and_mix_them(result):
    assert {t.n_notes for t in result.trials} == set(SMALL.note_counts)
    assert {t.good_ms for t in result.trials} == set(SMALL.good_ms_values)


def test_summarize_by_good_ms_splits_each_cell(result):
    cells = summarize_by(result.trials, "good_ms")
    first = [c for c in cells if c.scenario == "TIMING_LATE" and c.strength == 0.15]
    assert {c.group for c in first} == set(SMALL.good_ms_values)
    assert sum(c.n for c in first) == SMALL.seeds


def test_markdown_has_all_sections(result):
    text = report.render_markdown(result, perf=None, smoke=None, date="2026-10-30")
    for heading in ("## 1.", "## 2.", "## 3.", "## 4.", "## 한계"):
        assert heading in text
    assert "`TIMING_LATE`" in text and "`CLEAN_NOVICE`" in text


def test_results_json_is_serializable(result):
    data = report.results_dict(result, perf=None, smoke=None)
    assert json.loads(json.dumps(data))["trials"] == len(result.trials)


def test_samples_are_small_and_valid(tmp_path):
    requests = report.write_samples(tmp_path)
    assert len(requests) == len(report.SAMPLE_PICKS)
    files = sorted(tmp_path.glob("*.json"))
    assert len(files) == len(report.SAMPLE_PICKS)
    for f in files:
        assert f.stat().st_size < 60_000
        payload = json.loads(f.read_text(encoding="utf-8"))
        assert {"request", "response", "scenario"} <= payload.keys()


def test_server_smoke_matches_direct_call(tmp_path):
    rows = server_smoke(report.write_samples(tmp_path))
    assert rows and all(r["status"] == 200 and r["same"] for r in rows)


def test_measure_performance_reports_sizes():
    rows = measure_performance(sizes=(300,), repeats=1)
    assert rows[0]["hits"] >= 300
    assert rows[0]["analyzeSec"] >= 0


def test_cli_writes_outputs(tmp_path):
    out = tmp_path / "eval"
    assert main(["--seeds", "2", "--out", str(out), "--skip-perf"]) == 0
    for name in ("results.md", "results.json", "sensitivity.png"):
        assert (out / name).stat().st_size > 0
    assert (out / "samples").is_dir()


def test_cli_logs_to_mlflow(tmp_path, monkeypatch):
    mlflow = pytest.importorskip("mlflow")
    monkeypatch.setenv("MLFLOW_ALLOW_FILE_STORE", "true")
    uri = (tmp_path / "mlruns").as_uri()
    out = tmp_path / "eval"
    assert (
        main(["--seeds", "2", "--out", str(out), "--skip-perf", "--mlflow", "--tracking-uri", uri])
        == 0
    )
    mlflow.set_tracking_uri(uri)
    experiment = mlflow.get_experiment_by_name(report.EXPERIMENT_NAME)
    assert experiment is not None
    runs = mlflow.search_runs([experiment.experiment_id])
    assert len(runs) == 1
    assert "metrics.recall/TIMING_LATE/0.4" in runs.columns
    assert "metrics.fpRate/CLEAN_NOVICE" in runs.columns


@pytest.mark.parametrize("detected", [0, 100])
def test_sensitivity_plot_handles_all_or_none_detected(tmp_path, detected):
    """탐지율이 0%·100%일 때 윌슨 구간과의 차이가 부동소수점으로 음수가 되어도 그려진다."""
    from ssaplash_ai.coach_eval.metrics import Trial
    from ssaplash_ai.coach_eval.runner import RunResult

    trials = [
        Trial("TIMING_LATE", "PLANTED", 0.4, ("TIMING_LATE",), detected=i < detected)
        for i in range(100)
    ]
    path = tmp_path / "plot.png"
    report.write_sensitivity_plot(RunResult(SMALL, trials, 0.0), path)
    assert path.stat().st_size > 0
