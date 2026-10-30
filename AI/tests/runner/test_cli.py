"""check-data 명령 테스트."""

from __future__ import annotations

from pathlib import Path

import pytest

from ssaplash_ai.bench.cli import main


def _write_yaml(path: Path, root: Path, expected: int) -> Path:
    path.write_text(
        f"name: cli_musdb\nkind: musdb\nroot: {root.as_posix()}\nsubset: test\n"
        f"expected_songs: {expected}\n",
        encoding="utf-8",
    )
    return path


def test_정상이면_0을_돌려주고_곡_수와_길이를_출력한다(
    musdb_root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    cfg = _write_yaml(tmp_path / "ok.yaml", musdb_root, 2)
    assert main(["check-data", str(cfg)]) == 0
    out = capsys.readouterr().out
    assert "[cli_musdb] 곡 2개 (기대 2), 길이 합 0.1분, 누락 0건" in out
    assert "상태: 정상" in out


def test_누락이_있으면_1을_돌려주고_파일을_나열한다(
    musdb_root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    (musdb_root / "test" / "Song A" / "mixture.wav").unlink()
    cfg = _write_yaml(tmp_path / "bad.yaml", musdb_root, 2)
    assert main(["check-data", str(cfg)]) == 1
    out = capsys.readouterr().out
    assert "누락: Song A/mixture.wav" in out
    assert "상태: 문제 있음" in out


def test_yaml_여러_개를_한_번에_점검한다(
    musdb_root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    ok = _write_yaml(tmp_path / "a.yaml", musdb_root, 2)
    bad = _write_yaml(tmp_path / "b.yaml", musdb_root, 50)
    assert main(["check-data", str(ok), str(bad)]) == 1
    assert capsys.readouterr().out.count("[cli_musdb]") == 2
