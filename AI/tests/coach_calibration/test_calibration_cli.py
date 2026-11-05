"""진입점: 끝에 남기는 한 줄 상태, 종료 코드, 실패 줄에 비밀이 없는지."""

from __future__ import annotations

import pytest

from calibration_helpers import late_gradient_rows
from ssaplash_ai.coach_calibration.cli import main
from ssaplash_ai.coach_calibration.source import ALLOWED_COLUMNS, DSN_ENV, ListSource


@pytest.fixture
def uri(tmp_path, monkeypatch):
    monkeypatch.setenv("MLFLOW_ALLOW_FILE_STORE", "true")
    return (tmp_path / "mlruns").as_uri()


def _status_lines(capsys) -> list[str]:
    return [
        line
        for line in capsys.readouterr().out.splitlines()
        if line.startswith("coach-calibration")
    ]


def test_ok_run_prints_one_status_line_and_exits_zero(uri, capsys):
    code = main(
        ["--tracking-uri", uri, "--skip-reeval"],
        source=ListSource(late_gradient_rows(60), columns=ALLOWED_COLUMNS),
    )

    (line,) = _status_lines(capsys)
    assert code == 0
    assert line.startswith("coach-calibration status=OK ")
    assert "sessions=60" in line and "valid=60" in line and "run=" in line


def test_skipped_run_prints_the_reason_and_exits_zero(uri, capsys):
    main(["--tracking-uri", uri, "--skip-reeval"], source=ListSource(late_gradient_rows(60)))
    capsys.readouterr()

    code = main(["--tracking-uri", uri, "--skip-reeval"], source=ListSource(late_gradient_rows(60)))

    (line,) = _status_lines(capsys)
    assert code == 0 and "status=SKIPPED" in line and "reason=NOT_ENOUGH_NEW_SESSIONS" in line


def test_disallowed_column_prints_names_only_and_exits_one(uri, capsys):
    rows = late_gradient_rows(60)
    for row in rows:
        row["client_meta"] = "SECRET-VALUE-123"

    code = main(["--tracking-uri", uri], source=ListSource(rows))

    out = capsys.readouterr().out
    assert code == 1
    assert "status=FAIL" in out and "DisallowedColumnError" in out and "columns=client_meta" in out
    assert "SECRET-VALUE-123" not in out


def test_missing_dsn_fails_without_printing_connection_details(uri, monkeypatch, capsys):
    monkeypatch.delenv(DSN_ENV, raising=False)

    code = main(["--tracking-uri", uri])

    out = capsys.readouterr().out
    assert code == 1 and "status=FAIL" in out and "RuntimeError" in out
    assert "postgresql" not in out


def test_invalid_policy_file_fails(uri, tmp_path, capsys):
    bad = tmp_path / "policy.yaml"
    bad.write_text("targets:\n  TIMNG: [0.1, 0.2]\n", encoding="utf-8")

    code = main(
        ["--tracking-uri", uri, "--policy", str(bad)], source=ListSource(late_gradient_rows(60))
    )

    assert code == 1 and "error=PolicyError" in capsys.readouterr().out


def test_policy_path_from_environment_that_does_not_exist_fails(uri, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("SSAPLASH_CALIBRATION_POLICY", str(tmp_path / "missing.yaml"))

    code = main(["--tracking-uri", uri], source=ListSource(late_gradient_rows(60)))

    assert code == 1 and "error=PolicyError" in capsys.readouterr().out


def test_policy_path_can_come_from_the_environment(uri, tmp_path, monkeypatch, capsys):
    path = tmp_path / "policy.yaml"
    path.write_text("targets:\n  TIMING: [0.30, 0.40]\n", encoding="utf-8")
    monkeypatch.setenv("SSAPLASH_CALIBRATION_POLICY", str(path))

    code = main(["--tracking-uri", uri, "--skip-reeval"], source=ListSource(late_gradient_rows(60)))

    (line,) = _status_lines(capsys)
    assert code == 0 and "candidates=1" in line and "approval=pending" in line


def test_force_option_runs_without_new_sessions(uri, capsys):
    rows = late_gradient_rows(60)
    main(["--tracking-uri", uri, "--skip-reeval"], source=ListSource(rows))
    capsys.readouterr()

    code = main(["--tracking-uri", uri, "--skip-reeval", "--force"], source=ListSource(rows))

    (line,) = _status_lines(capsys)
    assert code == 0 and line.startswith("coach-calibration status=OK ")
