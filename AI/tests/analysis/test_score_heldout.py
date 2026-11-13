"""실제 녹음 학습 확인 채점표 스크립트 테스트."""

from __future__ import annotations

import csv
import importlib.util
import sys
from pathlib import Path

import yaml

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "score_heldout.py"
PADS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")


def _load():
    spec = importlib.util.spec_from_file_location("score_heldout", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _row(ds: str, song: str, tom: tuple[int, int, int], false: int, pedal=(0, 0, 0)) -> dict:
    row = {"candidate": "pk_gap30", "dataset": ds, "songId": song, "tomFalseKept": false}
    for m, v in zip(("tp", "fp", "fn"), tom, strict=True):
        row[f"{m}MID_TOM"] = v
        row[f"{m}SMALL_TOM"] = 0
        row[f"{m}FLOOR_TOM"] = 0
    for m, v in zip(("tp", "fp", "fn"), pedal, strict=True):
        row[f"{m}HIHAT_PEDAL9"] = v
    return row


def _write(folder: Path, rows: list[dict]) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "by_song.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return folder


ENST_SONGS = {1: "drummer_1/a", 2: "drummer_2/b"}
MDB_FOLDS = {1: ["m1"], 2: ["m2"]}


def _all_songs(tom_of, false_of, pedal=(0, 0, 0)) -> list[dict]:
    rows = [_row("enst_minus_one", s, tom_of(d), false_of(d)) for d, s in ENST_SONGS.items()]
    rows += [_row("mdb_drums", f[0], tom_of(k), 0, pedal) for k, f in MDB_FOLDS.items()]
    rows.append(_row("gmd_test", "g", (10, 0, 0), 0))
    return rows


def _folds(tmp_path: Path) -> Path:
    path = tmp_path / "folds.yaml"
    path.write_text(
        yaml.safe_dump({"mdb_folds": MDB_FOLDS, "runs": {"run_d1": 1, "run_d2": 2}}),
        encoding="utf-8",
    )
    return path


def test_안_본_곡만_모아_비교하고_판정한다(tmp_path: Path, monkeypatch, capsys):
    # 학습 d1은 드러머 1·묶음 1을 안 봄: 그 곡에서 탐을 잘 맞힘(9/1/1). 본 곡은 일부러 다 틀림(0/9/9)
    def run_rows(fold: int) -> list[dict]:
        return _all_songs(
            lambda k: (9, 1, 1) if k == fold else (0, 9, 9),
            lambda d: 1 if d == fold else 99,
            pedal=(8, 2, 1),
        )

    r1 = _write(tmp_path / "r1", run_rows(1))
    r2 = _write(tmp_path / "r2", run_rows(2))
    # 기준 tom_6cls: 모든 곡 5/10/5, drummer_1 정답에 없는 탐 10
    ref = _write(tmp_path / "ref", _all_songs(lambda k: (5, 10, 5), lambda d: 10, pedal=(5, 5, 5)))
    out = tmp_path / "out.md"
    argv = ["score_heldout.py", "--run", f"run_d1={r1}", "--run", f"run_d2={r2}"]
    argv += ["--compare", f"tom_6cls={ref}", "--folds", str(_folds(tmp_path)), "--out", str(out)]
    monkeypatch.setattr(sys, "argv", argv)
    assert _load().main() == 0
    text = out.read_text(encoding="utf-8")
    # 합친 결과는 안 본 곡만: ENST 두 곡 다 9/1/1 → F1 0.9, 정답에 없는 탐 1+1
    assert "| real_heldout | 0.900 | 18 / 2 / 2 | 2 |" in text
    assert "| tom_6cls | 0.400 | 10 / 20 / 10 | 20 |" in text
    assert "H1(실제 녹음 데이터): 맞음" in text
    assert "H1 페달: 맞음" in text  # 정밀도 0.8, F1 0.84 > 0.5
    assert "gmd_test" in text


def test_같은_곡이_두_학습에서_나오면_오류(tmp_path: Path):
    m = _load()
    folds = {"mdb_folds": {1: ["m1"], 2: ["m1"]}, "runs": {"a": 1, "b": 2}}
    songs = {"mdb_drums": {"m1": {"tom": [1, 0, 0], "pedal": [0, 0, 0], "false": [0, 0, 0]}}}
    try:
        m.combine_runs({"a": songs, "b": songs}, folds)
    except ValueError as e:
        assert "두 학습" in str(e)
    else:
        raise AssertionError("오류가 나야 함")


def test_드러머_번호는_곡_id_앞부분에서():
    m = _load()
    assert m.drummer_of("drummer_3/107_minus-one_salsa_sticks") == 3
    assert m.drummer_of("MusicDelta_Rock") is None
