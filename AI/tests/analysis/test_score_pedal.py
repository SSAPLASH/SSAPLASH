"""페달 하이햇 비교표 스크립트 테스트 (S15P31A307-164 설계 v0.2 4-7절)."""

from __future__ import annotations

import csv
import importlib.util
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "score_pedal.py"


def _load():
    spec = importlib.util.spec_from_file_location("score_pedal", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def _rule_row(cand: str, ds: str, song: str, pedal: tuple, hihat9: tuple, hihat: tuple) -> dict:
    row = {"candidate": cand, "dataset": ds, "songId": song}
    for k, v in zip(("tp", "fp", "fn"), pedal, strict=True):
        row[f"{k}HIHAT_PEDAL9"] = v
    for k, v in zip(("tp", "fp", "fn"), hihat9, strict=True):
        row[f"{k}HIHAT9"] = v
    for k, v in zip(("tp", "fp", "fn"), hihat, strict=True):
        row[f"{k}HIHAT"] = v
    row["pedalAsHihat"], row["hihatAsPedal"] = pedal[2], 0
    return row


def test_규칙_결과와_벤치_결과를_같은_표로_묶고_판정한다(tmp_path: Path, monkeypatch, capsys):
    rows = []
    for ds in ("mdb_drums", "gmd_test"):
        for song in ("a", "b"):
            # 기준: 페달을 하나도 못 냄. 페달 모델: 페달 4개 중 3개 맞힘, 헛것 1
            rows.append(_rule_row("base", ds, song, (0, 0, 4), (10, 4, 0), (14, 0, 0)))
            rows.append(_rule_row("ped", ds, song, (3, 1, 1), (10, 1, 0), (14, 0, 0)))
    _write(tmp_path / "re" / "by_song.csv", rows)

    run = tmp_path / "run"
    base = {"model": "d2m", "dataset": "mdb_drums"}
    _write(run / "results.csv", [{**base, "songId": s, "error": ""} for s in ("a", "b")])
    hbc = []
    for s in ("a", "b"):
        for scheme, label, c in (
            ("pads9", "HIHAT_PEDAL", (1, 5, 3)),
            ("pads9", "HIHAT", (10, 2, 0)),
            ("pads", "HIHAT", (11, 1, 3)),
            ("pads9", "PEDAL_AS_HIHAT", (2, 0, 0)),
            ("pads9", "HIHAT_AS_PEDAL", (1, 0, 0)),
        ):
            hbc.append(
                {**base, "songId": s, "scheme": scheme, "label": label, "windowMs": 50}
                | dict(zip(("tp", "fp", "fn"), c, strict=True))
            )
    _write(run / "hits_by_class.csv", hbc)

    out = tmp_path / "pedal.md"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "score_pedal.py",
            "--rule-eval",
            f"base={tmp_path / 're'}@base",
            "--rule-eval",
            f"ped={tmp_path / 're'}@ped",
            "--run",
            f"d2m={run}",
            "--baseline",
            "base",
            "--out",
            str(out),
        ],
    )
    assert _load().main() == 0
    text = out.read_text(encoding="utf-8")
    # 페달 모델: tp 6, fp 2, fn 2 → F1 0.75, 정밀도 0.75
    assert "| ped | 0.750" in text and "| base | 0.000" in text
    assert "- ped: 채택 가능" in text
    # drum2midi는 GMD 결과가 없고 MDB 페달 F1·정밀도가 낮음
    assert "- d2m: 기준 못 넘음" in text and "gmd_test 결과 없음" in text


def test_심벌_비교표는_혼동과_판정을_낸다(tmp_path: Path, monkeypatch):
    spec = importlib.util.spec_from_file_location("score_cymbal", SCRIPT.parent / "score_cymbal.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    folder = tmp_path / "re"
    cand_rows, conf_rows, song_rows = [], [], []
    for cand, crash, ride in (("now", 0.3, 0.7), ("new", 0.6, 0.8)):
        for ds in ("mdb_drums", "enst_minus_one"):
            cand_rows.append(
                {
                    "candidate": cand,
                    "dataset": ds,
                    "f1CRASH": crash,
                    "f1RIDE": ride,
                    "f1KICK": 0.9,
                    "f1SNARE": 0.8,
                    "f1HIHAT": 0.85,
                    "f1Tom": 0.5,
                    "cymbalMatched": 10,
                    "cymbalFalseKept": 1,
                    "cymbalMissed": 1,
                }
            )
            conf_rows.append(
                {
                    "candidate": cand,
                    "dataset": ds,
                    "group": "cymbal",
                    "truePad": "CRASH",
                    "predPad": "RIDE",
                    "count": 4,
                }
            )
            song_rows.append(
                {"candidate": cand, "dataset": ds, "songId": "a"}
                | {f"{k}{p}": 1 for k in ("tp", "fp", "fn") for p in ("CRASH", "RIDE")}
            )
    _write(folder / "candidates.csv", cand_rows)
    _write(folder / "confusion.csv", conf_rows)
    _write(folder / "by_song.csv", song_rows)
    out = tmp_path / "cym.md"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "score_cymbal.py",
            "--rule-eval",
            f"now={folder}@now",
            "--rule-eval",
            f"new={folder}@new",
            "--baseline",
            "now",
            "--out",
            str(out),
        ],
    )
    assert mod.main() == 0
    text = out.read_text(encoding="utf-8")
    assert "| new | 0.600 | 0.800 |" in text and "| 4 | 0 |" in text
    assert "- new: 채택 가능" in text
