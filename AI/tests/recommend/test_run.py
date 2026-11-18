from __future__ import annotations

from pathlib import Path

import pytest

from ssaplash_ai.recommend import run
from ssaplash_ai.recommend.simulate import SimConfig
from ssaplash_ai.recommend.source import SyntheticSource


def source() -> SyntheticSource:
    return SyntheticSource(SimConfig(seed=1, n_users=60, n_songs=30))


ARGS = ["--models", "M0", "--bootstrap", "10"]


def test_from_views_evaluates_in_memory_without_files(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    code = run.main(
        ["--from-views", "--stage", "P2", "--p2-approval", "시험", *ARGS], source=source()
    )
    assert code == 0
    assert "M0" in capsys.readouterr().out
    assert list(tmp_path.iterdir()) == []


def test_from_views_needs_the_p2_approval(capsys) -> None:
    assert run.main(["--from-views", "--stage", "P2", *ARGS], source=source()) == 2
    assert "데이터 오류" in capsys.readouterr().err


def test_from_views_refuses_the_synthetic_stage(capsys) -> None:
    assert run.main(["--from-views", "--stage", "P0", *ARGS], source=source()) == 2
    assert "P0" in capsys.readouterr().err


def test_user_data_cannot_come_from_a_csv_folder(tmp_path: Path, capsys) -> None:
    code = run.main(["--data", str(tmp_path), "--stage", "P2", "--p2-approval", "시험", *ARGS])
    assert code == 2
    assert "--from-views" in capsys.readouterr().err


@pytest.mark.parametrize("flag", ["--from-views", "--synthetic"])
def test_the_sources_are_exclusive(flag: str) -> None:
    with pytest.raises(SystemExit):
        run.main([flag, "--data", "x", "--stage", "P0"])
