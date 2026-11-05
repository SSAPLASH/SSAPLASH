"""공용 곡 메타데이터 초안 변환기(`meta_import.py`)와 `song_meta`의 연도 열."""

from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
import pytest

from ssaplash_ai.recommend.data import DataError, load_dataset
from ssaplash_ai.recommend.graph import song_features
from ssaplash_ai.recommend.meta_import import convert, main
from ssaplash_ai.recommend.simulate import SimConfig, generate

HEADER = [
    "title",
    "artist",
    "genre",
    "subGenres",
    "mood",
    "energy",
    "releaseYear",
    "language",
    "drumStyle",
    "source",
    "sourceNote",
]


def write_draft(path: Path, rows: list[list[str]], bom: bool = True) -> Path:
    with path.open("w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    return path


def write_catalog(path: Path, rows: list[tuple[int, str, str]]) -> Path:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["song_id", "title", "artist"])
        w.writerows(rows)
    return path


ROWS = [
    ["기본 8비트", "", "PRACTICE", "", "", "", "", "INSTRUMENTAL", "EIGHT_BEAT", "HUMAN", ""],
    [
        "Hail to the King",
        "Avenged Sevenfold",
        "METAL",
        "ROCK",
        "DARK;ENERGETIC",
        "4",
        "2013",
        "EN",
        "",
        "HUMAN",
        "",
    ],
    ["Beggin'", "Måneskin", "ROCK", "", "ENERGETIC", "4", "2017", "EN", "", "HUMAN", ""],
]
CATALOG = [
    (1, "기본 8비트", ""),
    (7, "Hail to the King", "Avenged Sevenfold"),
    (9, "Beggin’", "MÅNESKIN"),
]


def read_out(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def test_BOM이_있는_초안을_열_이름과_곡_id를_바꿔_변환한다(tmp_path: Path):
    out = tmp_path / "song_meta.csv"
    report = convert(
        write_draft(tmp_path / "d.csv", ROWS), write_catalog(tmp_path / "c.csv", CATALOG), out
    )
    assert report.matched == 3 and not report.unmatched and not report.ambiguous
    frame = read_out(out).set_index("song_id")
    assert list(frame.columns) == [
        "genre",
        "sub_genres",
        "mood",
        "energy",
        "language",
        "drum_style",
        "release_year",
    ]
    assert (
        frame.loc["7", "sub_genres"] == "ROCK"
        and frame.loc["7", "mood"] == "DARK;ENERGETIC"
        and frame.loc["7", "release_year"] == "2013"
    )
    assert frame.loc["1", "genre"] == "PRACTICE" and frame.loc["1", "energy"] == ""
    assert list(frame.index) == ["1", "7", "9"]  # 곡 id 순


def test_따옴표와_대소문자_표기가_달라도_정규화로_맞추고_그_수를_센다(tmp_path: Path):
    report = convert(
        write_draft(tmp_path / "d.csv", ROWS),
        write_catalog(tmp_path / "c.csv", CATALOG),
        tmp_path / "o.csv",
    )
    assert report.matched_normalized == 1  # Beggin' / Måneskin ↔ Beggin’ / MÅNESKIN


def test_아티스트가_비어_있는_연습_패턴은_제목만으로_맞춘다(tmp_path: Path):
    out = tmp_path / "o.csv"
    convert(
        write_draft(tmp_path / "d.csv", ROWS[:1]), write_catalog(tmp_path / "c.csv", CATALOG), out
    )
    assert list(read_out(out)["song_id"]) == ["1"]


def test_곡_목록에_없거나_모호한_행은_넣지_않고_보고서에_남긴다(tmp_path: Path):
    catalog = write_catalog(
        tmp_path / "c.csv", [(1, "기본 8비트", ""), (2, "Dup", "A"), (3, "Dup", "A")]
    )
    rows = ROWS[:2] + [["Dup", "A", "ROCK", "", "", "", "", "", "", "HUMAN", ""]]
    out = tmp_path / "o.csv"
    report = convert(write_draft(tmp_path / "d.csv", rows), catalog, out)
    assert (
        report.matched == 1
        and report.unmatched == ["Hail to the King / Avenged Sevenfold"]
        and report.ambiguous == ["Dup / A"]
    )
    assert list(read_out(out)["song_id"]) == ["1"]


def test_초안에_같은_곡이_두_번_있으면_뒤의_것은_넣지_않고_알린다(tmp_path: Path):
    rows = [ROWS[0], ROWS[0]]
    report = convert(
        write_draft(tmp_path / "d.csv", rows),
        write_catalog(tmp_path / "c.csv", CATALOG),
        tmp_path / "o.csv",
    )
    assert report.matched == 1 and report.ambiguous == ["기본 8비트 (초안에 중복)"]


@pytest.mark.parametrize(
    "column,value,message",
    [
        (2, "SYNTHWAVE", "genre"),
        (3, "PUNK;POP;JAZZ", "sub_genres"),
        (4, "ANGRY", "mood"),
        (5, "6", "energy"),
        (6, "13", "release_year"),
        (7, "FR", "language"),
        (8, "EIGHT_BEAT;SHUFFLE;HALF_TIME;FOUR_ON_FLOOR", "drum_style"),
        (9, "MAYBE", "source"),
    ],
)
def test_허용_값을_벗어나면_아무것도_쓰지_않고_멈춘다(
    tmp_path: Path, column: int, value: str, message: str
):
    bad = list(ROWS[1])
    bad[column] = value
    out = tmp_path / "o.csv"
    with pytest.raises(DataError, match=message):
        convert(
            write_draft(tmp_path / "d.csv", [ROWS[0], bad]),
            write_catalog(tmp_path / "c.csv", CATALOG),
            out,
        )
    assert not out.exists()


def test_외부_DB_출처는_이용_조건이_있어야_한다(tmp_path: Path):
    row = list(ROWS[1])
    row[9] = "EXTERNAL_DB"
    with pytest.raises(DataError, match="source_note"):
        convert(
            write_draft(tmp_path / "d.csv", [row]),
            write_catalog(tmp_path / "c.csv", CATALOG),
            tmp_path / "o.csv",
        )
    row[10] = "공개 API, 비상업 이용 가능"
    assert (
        convert(
            write_draft(tmp_path / "d.csv", [row]),
            write_catalog(tmp_path / "c.csv", CATALOG),
            tmp_path / "o.csv",
        ).matched
        == 1
    )


def test_여러_위반은_모아서_보고하고_열이_다르면_거부한다(tmp_path: Path):
    bad1, bad2 = list(ROWS[1]), list(ROWS[2])
    bad1[2], bad2[4] = "X", "Y"
    with pytest.raises(DataError, match="2건"):
        convert(
            write_draft(tmp_path / "d.csv", [bad1, bad2]),
            write_catalog(tmp_path / "c.csv", CATALOG),
            tmp_path / "o.csv",
        )
    broken = tmp_path / "b.csv"
    broken.write_text("title,artist,genre\nA,B,ROCK\n", encoding="utf-8")
    with pytest.raises(DataError, match="열이 규격과 다릅니다"):
        convert(broken, write_catalog(tmp_path / "c.csv", CATALOG), tmp_path / "o.csv")
    with pytest.raises(DataError, match="행이 없습니다"):
        convert(
            write_draft(tmp_path / "e.csv", []),
            write_catalog(tmp_path / "c.csv", CATALOG),
            tmp_path / "o.csv",
        )


def test_같은_입력은_같은_출력을_만든다(tmp_path: Path):
    d, c = write_draft(tmp_path / "d.csv", ROWS), write_catalog(tmp_path / "c.csv", CATALOG)
    convert(d, c, tmp_path / "a.csv")
    convert(d, c, tmp_path / "b.csv")
    assert (tmp_path / "a.csv").read_bytes() == (tmp_path / "b.csv").read_bytes()


def test_실행기는_성공_0_규격_위반_2를_돌려준다(tmp_path: Path, capsys):
    d, c = write_draft(tmp_path / "d.csv", ROWS), write_catalog(tmp_path / "c.csv", CATALOG)
    assert main(["--draft", str(d), "--catalog", str(c), "--out", str(tmp_path / "o.csv")]) == 0
    assert "곡 맞춤 3행" in capsys.readouterr().out
    bad = list(ROWS[1])
    bad[2] = "X"
    assert (
        main(
            [
                "--draft",
                str(write_draft(tmp_path / "bad.csv", [bad])),
                "--catalog",
                str(c),
                "--out",
                str(tmp_path / "o2.csv"),
            ]
        )
        == 2
    )
    assert "데이터 오류" in capsys.readouterr().err


def test_변환한_파일을_로더가_읽고_연도는_연대_특징_노드가_된다(tmp_path: Path):
    synthetic = generate(SimConfig(seed=2, n_songs=30, n_users=60))
    root = synthetic.write(tmp_path / "data")
    ids = [int(s) for s in synthetic.songs["song_id"]][:3]
    catalog = write_catalog(
        tmp_path / "c.csv", [(ids[0], "A", ""), (ids[1], "B", "X"), (ids[2], "C", "Y")]
    )
    rows = [
        ["A", "", "PRACTICE", "", "", "", "", "INSTRUMENTAL", "EIGHT_BEAT", "HUMAN", ""],
        ["B", "X", "ROCK", "", "ENERGETIC", "4", "2013", "EN", "", "HUMAN", ""],
        ["C", "Y", "POP", "", "", "", "1982", "EN", "", "HUMAN", ""],
    ]
    convert(write_draft(tmp_path / "d.csv", rows), catalog, root / "song_meta.csv")
    data = load_dataset(root, "P0")
    meta = data.song_meta.set_index("song_id")
    assert meta.loc[ids[1], "release_year"] == 2013 and pd.isna(meta.loc[ids[0], "release_year"])
    features = song_features(data, meta=True, rhythm_clusters=4, seed=0, total=1.0)
    assert "era:2010" in features[ids[1]] and "era:1980" in features[ids[2]]
    assert not any(k.startswith("era:") for k in features[ids[0]])


def test_연도가_네_자리_숫자가_아니면_로더가_거부한다(tmp_path: Path):
    root = generate(SimConfig(seed=3, n_songs=20, n_users=40)).write(tmp_path / "data")
    (root / "song_meta.csv").write_text("song_id,release_year\n1,13\n", encoding="utf-8")
    with pytest.raises(DataError, match="release_year"):
        load_dataset(root, "P0")
