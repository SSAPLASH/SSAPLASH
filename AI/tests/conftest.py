"""공용 fixture. 도구 함수는 helpers.py에."""

from __future__ import annotations

from pathlib import Path

import pytest

from helpers import make_musdb_song


@pytest.fixture
def musdb_root(tmp_path: Path) -> Path:
    """test 하위에 곡 2개가 있는 가짜 MUSDB 폴더."""
    root = tmp_path / "musdb18hq"
    make_musdb_song(root / "test" / "Song A", 1.0)
    make_musdb_song(root / "test" / "Song B", 2.0)
    return root
