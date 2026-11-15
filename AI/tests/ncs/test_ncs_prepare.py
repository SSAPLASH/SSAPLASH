"""NCS 기본곡 원본 모으기 스크립트 테스트."""

from __future__ import annotations

import csv
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

AI_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = AI_ROOT / "scripts" / "ncs_prepare.py"
SONGS_CSV = AI_ROOT / "configs" / "ncs" / "songs.csv"


def _load():
    spec = importlib.util.spec_from_file_location("ncs_prepare", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["ncs_prepare"] = module  # dataclass가 모듈을 찾을 수 있게
    spec.loader.exec_module(module)
    return module


ncs = _load()


def _row(i: int, **over) -> dict:
    row = {
        "no": f"{i:02d}",
        "candidate_no": str(i),
        "youtube_id": f"vid{i:08d}",
        "title": f"Title {i}",
        "artist": f"Artist {i}",
        "ncs_path": f"path{i}",
        "genre": "House",
        "year": "2016",
        "license": f"Song: Artist {i} - Title {i} [NCS Release]",
    }
    row.update(over)
    return row


def _write_songs(path: Path, rows: list[dict]) -> Path:
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=ncs.COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return path


def _audio(path: Path, seconds: float) -> None:
    """확장자는 .opus지만 내용은 wav. probe는 내용으로 형식을 읽음."""
    sr = 8000
    sf.write(str(path), np.zeros((int(sr * seconds), 2), dtype=np.float32), sr, format="WAV")


def test_repo_songs_csv_is_valid():
    songs = ncs.read_songs(SONGS_CSV)
    assert len(songs) == 50
    assert songs[8].artist == "TULE"  # 9번 Fearless pt. II는 ncs.io 표기
    assert songs[0].stem == "ncs_01 Cartoon, Jéja - On & On (feat. Daniel Levi)"
    assert songs[-1].stem == "ncs_50 Netrum, Halvorsen - Phoenix"
    # 윈도에서 못 쓰는 ? 는 뺌
    assert songs[26].stem == "ncs_27 Unknown Brain - Why Do I (feat. Bri Tolani)"
    assert len({s.stem for s in songs}) == 50


def test_safe_name_drops_invalid_chars():
    assert ncs.safe_name('a<b>c:"d/e\\f|g?h*i. ') == "abcdefghi"


def test_read_songs_collects_all_errors(tmp_path):
    rows = [_row(i) for i in range(1, 51)]
    rows[2]["license"] = "x" * 201
    rows[3]["youtube_id"] = rows[4]["youtube_id"]
    rows[5]["no"] = "99"
    with pytest.raises(ValueError) as e:
        ncs.read_songs(_write_songs(tmp_path / "s.csv", rows))
    msg = str(e.value)
    assert "license 201자" in msg
    assert "youtube_id 중복" in msg
    assert "no '99'" in msg


def test_read_songs_rejects_wrong_count(tmp_path):
    with pytest.raises(ValueError, match="곡 수 2"):
        ncs.read_songs(_write_songs(tmp_path / "s.csv", [_row(1), _row(2)]))


def test_prepare_copies_and_records_duration(tmp_path, monkeypatch):
    monkeypatch.setattr(ncs, "N_SONGS", 2)
    songs = _write_songs(tmp_path / "s.csv", [_row(1), _row(2)])
    src = tmp_path / "src"
    src.mkdir()
    _audio(src / "Artist 1 - Title 1 ｜ House ｜ NCS [vid00000001].opus", 1.5)
    _audio(src / "Artist 2 - Title 2 [vid00000002].opus", 0.5)
    _audio(src / "Other song [zzzzzzzzzzz].opus", 0.2)
    out = tmp_path / "out"
    out.mkdir()
    _audio(out / "ncs_01.opus", 0.1)  # 예전 이름 규칙 파일은 지워져야 함

    rows = ncs.prepare(src, songs, out)

    assert [r["file"] for r in rows] == [
        "ncs_01 Artist 1 - Title 1.opus",
        "ncs_02 Artist 2 - Title 2.opus",
    ]
    assert not (out / "ncs_01.opus").exists()
    assert [r["duration_ms"] for r in rows] == [1500, 500]
    assert all(r["copied"] for r in rows)
    assert (out / "durations.csv").is_file()
    # 두 번째 실행은 복사 건너뜀
    assert not any(r["copied"] for r in ncs.prepare(src, songs, out))


def test_prepare_fails_on_missing_or_duplicate(tmp_path, monkeypatch):
    monkeypatch.setattr(ncs, "N_SONGS", 2)
    songs = _write_songs(tmp_path / "s.csv", [_row(1), _row(2)])
    src = tmp_path / "src"
    src.mkdir()
    _audio(src / "a [vid00000001].opus", 0.1)
    _audio(src / "b [vid00000001].opus", 0.1)
    with pytest.raises(ValueError) as e:
        ncs.prepare(src, songs, tmp_path / "out")
    assert "같은 ID 파일 2개" in str(e.value)
    assert "[vid00000002].opus 없음" in str(e.value)


def test_main_returns_1_on_error(tmp_path, capsys):
    code = ncs.main(
        ["--src", str(tmp_path), "--songs", str(_write_songs(tmp_path / "s.csv", [_row(1)]))]
    )
    assert code == 1
    assert "곡 수 1" in capsys.readouterr().err
