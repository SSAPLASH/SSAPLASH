"""실제 기록 평가 세트: 허용 열 검사, 구간 사실 만들기, 평가 스크립트와 잇기. 내보낸 CSV를 흉내 낸 파일로 본다."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from ssaplash_ai.coach_eval.live_real_set import (
    CHART_COLUMNS,
    HIT_COLUMNS,
    SESSION_COLUMNS,
    ExportError,
    build_sets,
    load_cases,
    main,
)
from ssaplash_ai.coach_eval.live_tip_compare import markdown, run, sample_cases, summarize

STEP = 250
POSES = {"SNARE": {"pitch": -30.0, "yaw": 0.0}, "SMALL_TOM": {"pitch": -15.0, "yaw": 40.0}}


def _write(path: Path, columns: tuple[str, ...] | list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(columns))
        w.writeheader()
        for r in rows:
            w.writerow({k: "" if r.get(k) is None else r[k] for k in columns})


def _export(
    tmp: Path, *, extra_column: str | None = None, pitch: float = -30.0
) -> tuple[Path, Path]:
    export, charts = tmp / "export", tmp / "charts"
    export.mkdir()
    charts.mkdir()
    notes = [{"noteId": f"n{i}", "timeMs": i * STEP, "pad": "SNARE"} for i in range(40)]
    (charts / "7.json").write_text(
        json.dumps({"bpm": 120, "offsetMs": 0, "beatsPerBar": 4, "notes": notes}), encoding="utf-8"
    )
    session = {
        "session_key": "a1b2c3d4e5f6",
        "input_source": "STICK",
        "chart_version_ref": 7,
        "perfect_ms": 30,
        "good_ms": 60,
        "pad_poses": json.dumps(POSES),
        "live_coach_events": json.dumps([{"tMs": 3030, "tag": "LIVE_LATE", "text": "늦어요"}]),
        "played_date": "2026-11-12",
    }
    cols = list(SESSION_COLUMNS) + ([extra_column] if extra_column else [])
    _write(export / "sessions.csv", cols, [session])
    hits = [
        {
            "session_key": "a1b2c3d4e5f6",
            "seq": i,
            "t_ms": i * STEP + 30,
            "stick_id": i % 2,
            "pad": "SNARE",
            "judgement": "GOOD",
            "matched_note_id": f"n{i}",
            "delta_ms": 30,
            "velocity": 90,
            "pitch": pitch,
            "yaw": 0,
        }
        for i in range(40)
    ]
    _write(export / "hits.csv", HIT_COLUMNS, hits)
    return export, charts


def test_구간_사실_두_벌을_같은_이름으로_만든다(tmp_path: Path) -> None:
    export, charts = _export(tmp_path, pitch=-50.0)  # 스네어를 기준보다 낮게 침
    plain, aimed, summary = build_sets(export, charts)
    assert (summary.plays, summary.songs, summary.segments) == (1, 1, 1)
    assert [c.name for c in plain] == [c.name for c in aimed] == ["a1b2c3d4#0"]
    assert "aim" not in plain[0].facts and aimed[0].facts["aim"][0]["vertical"] == "LOW"
    assert plain[0].facts["ruleCoach"]["tags"] == ["LIVE_LATE"]
    assert summary.withAim == 1


@pytest.mark.parametrize("column", ["user_id", "email", "nickname", "memo"])
def test_허용하지_않은_열이_있으면_읽지_않는다(tmp_path: Path, column: str) -> None:
    export, charts = _export(tmp_path, extra_column=column)
    with pytest.raises(ExportError):
        build_sets(export, charts)
    assert (
        main(["--export", str(export), "--charts", str(charts), "--out", str(tmp_path / "o")]) == 2
    )


def test_채보가_없는_판은_건너뛴다(tmp_path: Path) -> None:
    export, charts = _export(tmp_path)
    (charts / "7.json").unlink()
    plain, _, summary = build_sets(export, charts)
    assert plain == [] and summary.skippedPlays == 1


def test_파일로_쓰고_평가_스크립트가_읽는다(tmp_path: Path) -> None:
    export, charts = _export(tmp_path, pitch=-50.0)
    out = tmp_path / "sets"
    assert main(["--export", str(export), "--charts", str(charts), "--out", str(out)]) == 0
    cases = load_cases(out / "real-aim.jsonl")
    assert list(cases) == ["a1b2c3d4#0"] and cases["a1b2c3d4#0"].aim
    good = json.dumps({"title": "앞당겨요", "sub": "박보다 살짝 일찍 쳐요"}, ensure_ascii=False)
    trials = run(lambda s, u: good, repeat=1, cases=cases)
    text = markdown(summarize("fake", trials), trials, cases)
    assert "| 구간 | 사실 |" in text and "스틱 끝 방향" in text and "앞당겨요" in text


def test_같은_씨앗이면_두_세트에서_같은_구간을_고른다() -> None:
    names = {f"k{i}#0": object() for i in range(20)}
    a = sample_cases(names, 5, seed=3)  # type: ignore[arg-type]
    b = sample_cases(dict(reversed(list(names.items()))), 5, seed=3)  # type: ignore[arg-type]
    assert list(a) == list(b) and len(a) == 5
    assert sample_cases(names, None, 0) is names  # type: ignore[arg-type]


def test_DB_채보_CSV로도_만든다(tmp_path: Path) -> None:
    export, charts = _export(tmp_path, pitch=-50.0)
    notes = [{"noteId": f"n{i}", "timeMs": i * STEP, "pad": "SNARE"} for i in range(40)]
    timing = {
        "bpm": 120,
        "offsetMs": 0,
        "timeSignature": "4/4",
        "ppq": 480,
        "tempoMap": [{"tick": 0, "bpm": 120}],
    }
    _write(
        export / "charts.csv",
        CHART_COLUMNS,
        [{"chart_version_ref": 7, "notes": json.dumps(notes), "timing": json.dumps(timing)}],
    )
    (charts / "7.json").unlink()
    plain, aimed, summary = build_sets(export)
    assert summary.segments == 1 and aimed[0].facts["aim"][0]["vertical"] == "LOW"
    assert main(["--export", str(export), "--out", str(tmp_path / "o")]) == 0
