"""공용 fixture. 도구 함수는 helpers.py에."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # 하위 폴더 테스트도 helpers를 import

from helpers import make_musdb_song  # noqa: E402


@pytest.fixture
def musdb_root(tmp_path: Path) -> Path:
    """test 하위에 곡 2개가 있는 테스트용 MUSDB 폴더."""
    root = tmp_path / "musdb18hq"
    make_musdb_song(root / "test" / "Song A", 1.0)
    make_musdb_song(root / "test" / "Song B", 2.0)
    return root
