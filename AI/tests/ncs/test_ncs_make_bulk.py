"""NCS 기본곡 등록 파일 만들기 스크립트 테스트."""

from __future__ import annotations

import csv
import importlib.util
import json
import sys
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

AI_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = AI_ROOT / "scripts" / "ncs_make_bulk.py"


def _load():
    spec = importlib.util.spec_from_file_location("ncs_make_bulk", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["ncs_make_bulk"] = module
    spec.loader.exec_module(module)
    return module


bulk = _load()
prep = sys.modules[bulk.read_songs.__module__]


def _chart(bpm: float, offset: int, notes: list[tuple[int, str]], duration_ms: int = 4000) -> dict:
    return {
        "schemaVersion": 1,
        "generator": "ADT_MODEL",
        "generatorVersion": "test@1",
        "metrics": {"durationMs": duration_ms},
        "charts": [
            {
                "difficulty": "NORMAL",
                "notationStatus": "UNAVAILABLE",
                "timing": {"bpm": bpm, "offsetMs": offset, "timeSignature": "4/4"},
                "notes": [
                    {"noteId": f"n{i + 1:04d}", "timeMs": t, "pad": p}
                    for i, (t, p) in enumerate(notes)
                ],
            }
        ],
    }


def _midi_notes(path: Path) -> list[tuple[int, int, int]]:
    """(절대 tick, 채널, 음 번호) 목록."""
    out, tick = [], 0
    for msg in mido.MidiFile(str(path)).tracks[0]:
        tick += msg.time
        if msg.type == "note_on":
            out.append((tick, msg.channel, msg.note))
    return out


def test_tempo_points_first_beat_on_integer_tick():
    pts = bulk.tempo_points({"bpm": 120.0, "offsetMs": 500})
    assert pts == [(0, 120.0), (480, 120.0)]
    assert bulk.tempo_points({"bpm": 100.0, "offsetMs": 0}) == [(0, 100.0)]
    # 첫 박 시각이 정수 tick에 안 떨어지면 0틱 구간 bpm을 조금 바꿔 첫 박을 정확히 맞춤
    pts = bulk.tempo_points({"bpm": 128.0, "offsetMs": 333})
    assert abs(bulk.ms_of(pts[1][0], pts) - 333) < 1e-6


def test_write_midi_drops_notes_before_first_beat(tmp_path):
    chart = _chart(120.0, 500, [(100, "KICK"), (470, "HIHAT"), (500, "SNARE"), (1250, "CRASH")])[
        "charts"
    ][0]
    stat = bulk.write_midi(chart, tmp_path / "a.mid", "a")
    # 100ms는 첫 박(500ms)보다 ppq/8(약 31ms) 넘게 앞이라 뺌. 470ms는 30ms 앞이라 BE가 첫 박으로 당겨 받음
    assert stat["dropped"] == 1
    assert stat["written"] == 3
    assert stat["roundtrip_ms"] <= 1.0
    notes = _midi_notes(tmp_path / "a.mid")
    assert [n[2] for n in notes] == [42, 38, 49]
    assert all(ch == 9 for _, ch, _ in notes)
    assert notes[1][0] == 480 and notes[2][0] == 1200


def test_render_review_keeps_length_and_level():
    sr = 8000
    mr = np.full((sr, 2), 0.9, dtype=np.float32)
    mix = bulk.render_review(
        mr, [{"timeMs": 0, "pad": "KICK"}, {"timeMs": 2000, "pad": "SNARE"}], sr
    )
    assert mix.shape == mr.shape
    assert float(np.max(np.abs(mix))) <= 0.99 + 1e-6


def _row(i: int) -> dict:
    return {
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


def test_build_writes_register_and_check(tmp_path, monkeypatch):
    monkeypatch.setattr(prep, "N_SONGS", 2)
    songs_csv = tmp_path / "songs.csv"
    with open(songs_csv, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=prep.COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows([_row(1), _row(2)])
    charts = tmp_path / "charts"
    sr = 8000
    for i, (offset, notes) in enumerate(
        [(0, [(0, "KICK"), (500, "SNARE")]), (250, [(250, "HIHAT")])], start=1
    ):
        d = charts / f"ncs_{i:02d} Artist {i} - Title {i}"
        d.mkdir(parents=True)
        (d / "chart.json").write_text(
            json.dumps(_chart(120.0, offset, notes, 1000)), encoding="utf-8"
        )
        sf.write(
            str(d / "accompaniment.flac"), np.zeros((sr, 2), dtype=np.float32), sr, subtype="PCM_16"
        )
    out, review = tmp_path / "bulk", tmp_path / "review"

    checks = bulk.build(songs_csv, charts, out, review)

    assert [c["문제"] for c in checks] == ["", ""]
    assert (out / "ncs_01 Artist 1 - Title 1.mid").is_file()
    assert sf.info(str(out / "ncs_02 Artist 2 - Title 2.wav")).subtype == "PCM_16"
    assert (review / "ncs_01 Artist 1 - Title 1.flac").is_file()
    with open(out / "register.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == bulk.REGISTER_COLUMNS
    assert rows[1]["offsetMs"] == "250"
    assert rows[1]["공개"] == "false"
    assert rows[0]["드럼리스 MR"] == "ncs_01 Artist 1 - Title 1.wav"


def test_main_returns_1_when_results_missing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(prep, "N_SONGS", 1)
    songs_csv = tmp_path / "songs.csv"
    with open(songs_csv, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=prep.COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerow(_row(1))
    code = bulk.main(["--songs", str(songs_csv), "--charts", str(tmp_path / "none"), "--no-review"])
    assert code == 1
    assert "서버 결과 없음" in capsys.readouterr().err


def _grid_notes(bpm: float, offset: float, n: int) -> list[tuple[int, str]]:
    """bpm·첫 박 기준 16분 칸에 놓인 노트."""
    step = 60000 / bpm / 4
    return [(round(offset + i * step), "HIHAT") for i in range(n)]


def test_fix_timing_snaps_drifting_bpm_to_integer():
    # 실제 곡은 87bpm인데 채보가 86.94로 잡아 뒤로 갈수록 밀리는 경우
    chart = _chart(86.94, 138, _grid_notes(87.0, 140, 800))["charts"][0]
    fixed, info = bulk.fix_timing(chart)
    assert fixed["bpm"] == 87.0
    assert abs(fixed["offsetMs"] - 140) <= 2
    assert info["고치기 전 벗어남 %"] > 30
    assert info["고친 뒤 벗어남 %"] == 0
    assert info["bpm 고침"].startswith("86.94→87")


def test_fix_timing_keeps_correct_non_integer_bpm():
    chart = _chart(158.5, 50, _grid_notes(158.5, 50, 800))["charts"][0]
    fixed, info = bulk.fix_timing(chart)
    assert fixed["bpm"] == 158.5 and fixed["offsetMs"] == 50
    assert info["bpm 고침"] == ""


def test_fix_timing_fixes_small_metronome_drift():
    # 165.02로 잡혀 벗어난 노트 비율은 낮지만 곡 끝으로 갈수록 메트로놈이 밀리는 경우(실제 곡 Phoenix)
    chart = _chart(165.02, 1163, _grid_notes(165.0, 1163, 1600))["charts"][0]
    fixed, info = bulk.fix_timing(chart)
    assert fixed["bpm"] == 165.0
    assert abs(info["고치기 전 메트로놈 밀림 ms"]) > 15
    assert abs(info["고친 뒤 메트로놈 밀림 ms"]) <= 2
