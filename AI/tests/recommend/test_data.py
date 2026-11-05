"""곡 추천 PoC 입력 로더와 시간순 분할(설계 문서 부록 B.2·B.7, 인수 조건 B.10)."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pandas as pd
import pytest

from ssaplash_ai.recommend.data import DataError, Dataset, load_dataset, temporal_split

PAD = json.dumps({"KICK": 0.5, "SNARE": 0.5})
TRANS = json.dumps({"KICK>SNARE": 0.5})
GRID = json.dumps({"groups": {"KICK": [1.0] + [0.0] * 11}})


def write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def make_dataset(root: Path, *, with_optional: bool = True) -> Path:
    """사용자 3명, 곡 3개(채보 4개), 연주 8번의 작고 올바른 데이터."""
    root.mkdir(parents=True, exist_ok=True)
    write_csv(
        root / "users.csv",
        ["user_key", "consent_recommendation", "consent_version"],
        [
            ["user-aaaaaaaa", "true", "2026-11-05"],
            ["user-bbbbbbbb", "true", "2026-11-05"],
            ["user-cccccccc", "true", "2026-11-05"],
        ],
    )
    write_csv(
        root / "songs.csv",
        ["song_id", "bpm", "duration_ms", "song_level", "public"],
        [
            ["1", "120", "60000", "BEGINNER", "true"],
            ["2", "100", "70000", "INTERMEDIATE", "true"],
            ["3", "140", "80000", "ADVANCED", "true"],
        ],
    )
    write_csv(
        root / "chart_features.csv",
        [
            "chart_id",
            "song_id",
            "difficulty",
            "avg_notes_per_sec",
            "peak_notes_2s",
            "pad_ratio",
            "transition_ratio",
            "rhythm_grid",
        ],
        [
            ["10", "1", "NORMAL", "2.5", "6", PAD, TRANS, GRID],
            ["11", "1", "HARD", "4.0", "10", PAD, TRANS, GRID],
            ["20", "2", "NORMAL", "3.5", "8", PAD, TRANS, GRID],
            [
                "30",
                "3",
                "NORMAL",
                "6.0",
                "14",
                PAD,
                TRANS,
                json.dumps({"excluded": "VARIABLE_TEMPO"}),
            ],
        ],
    )
    write_csv(
        root / "interactions.csv",
        ["user_key", "song_id", "chart_id", "played_at", "accuracy", "completed", "mode"],
        [
            ["user-aaaaaaaa", "1", "10", "2026-10-01T10:00:00Z", "80", "true", "RHYTHM"],
            ["user-aaaaaaaa", "2", "20", "2026-10-02T10:00:00Z", "70", "true", "RHYTHM"],
            ["user-aaaaaaaa", "1", "10", "2026-10-10T10:00:00Z", "88", "true", "RHYTHM"],
            ["user-bbbbbbbb", "1", "11", "2026-10-03T10:00:00Z", "60", "false", "RHYTHM"],
            ["user-bbbbbbbb", "2", "20", "2026-10-11T10:00:00Z", "75", "true", "SHEET"],
            ["user-cccccccc", "2", "20", "2026-10-04T10:00:00Z", "90", "true", "RHYTHM"],
            ["user-cccccccc", "3", "30", "2026-10-12T10:00:00Z", "65", "true", "RHYTHM"],
            ["user-cccccccc", "1", "10", "2026-10-13T10:00:00Z", "85", "true", "RHYTHM"],
        ],
    )
    if with_optional:
        write_csv(
            root / "exposures.csv",
            ["user_key", "song_id", "chart_id", "shown_at", "clicked", "context", "strategy"],
            [
                [
                    "user-aaaaaaaa",
                    "2",
                    "20",
                    "2026-10-05T10:00:00Z",
                    "true",
                    "SONG_PICKER",
                    "RULE_V1",
                ],
            ],
        )
        write_csv(
            root / "song_meta.csv",
            ["song_id", "genre", "sub_genres", "mood", "energy", "language", "drum_style"],
            [
                ["1", "ROCK", "PUNK;POP", "ENERGETIC", "4", "EN", "EIGHT_BEAT;FILL_HEAVY"],
                ["2", "JAZZ", "", "CALM", "", "", "SHUFFLE"],
            ],
        )
        write_csv(
            root / "weak_summary.csv",
            ["user_key", "pattern", "pad", "count", "avg_severity"],
            [
                ["user-aaaaaaaa", "PAD_LATE", "SNARE", "3", "0.6"],
            ],
        )
    return root


@pytest.fixture
def data(tmp_path: Path) -> Path:
    return make_dataset(tmp_path / "data")


def mutate(root: Path, name: str, column: str, row: int, value: str) -> None:
    """CSV 한 칸을 바꾼다."""
    path = root / name
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    df.loc[row, column] = value
    df.to_csv(path, index=False, encoding="utf-8")


def add_column(root: Path, name: str, column: str, value: str) -> None:
    path = root / name
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    df[column] = value
    df.to_csv(path, index=False, encoding="utf-8")


# ------------------------------------------------------------------ 로더: 정상


def test_올바른_데이터는_읽히고_JSON과_목록이_풀린다(data: Path):
    ds = load_dataset(data, "P0")
    assert isinstance(ds, Dataset)
    assert (
        ds.summary()["users"] == 3
        and ds.summary()["interactions"] == 8
        and ds.summary()["charts"] == 4
    )
    assert ds.chart_features.loc[0, "pad_ratio"] == {"KICK": 0.5, "SNARE": 0.5}
    assert ds.chart_features.loc[3, "rhythm_grid"] == {"excluded": "VARIABLE_TEMPO"}
    meta = ds.song_meta.set_index("song_id")
    assert meta.loc[1, "sub_genres"] == ("PUNK", "POP") and meta.loc[1, "energy"] == 4
    assert pd.isna(meta.loc[2, "energy"]) and meta.loc[2, "language"] == ""  # 비어 있으면 NaN


def test_연주는_시간순으로_정렬된다(data: Path):
    played = load_dataset(data, "P0").interactions["played_at"]
    assert played.is_monotonic_increasing
    assert str(played.dt.tz) == "UTC"


def test_선택_파일이_없어도_읽힌다(tmp_path: Path):
    ds = load_dataset(make_dataset(tmp_path / "d", with_optional=False), "P0")
    assert ds.exposures.empty and ds.song_meta.empty and ds.weak_summary.empty


def test_데이터_해시는_같은_파일이면_같고_바뀌면_달라진다(tmp_path: Path):
    a = load_dataset(make_dataset(tmp_path / "a"), "P0")
    b = load_dataset(make_dataset(tmp_path / "b"), "P0")
    assert a.data_hash == b.data_hash
    mutate(tmp_path / "b", "interactions.csv", "accuracy", 0, "81")
    assert load_dataset(tmp_path / "b", "P0").data_hash != a.data_hash


# ------------------------------------------------------------------ 로더: 정책 위반은 멈춘다


@pytest.mark.parametrize(
    "file",
    [
        "users.csv",
        "songs.csv",
        "chart_features.csv",
        "interactions.csv",
        "exposures.csv",
        "song_meta.csv",
        "weak_summary.csv",
    ],
)
@pytest.mark.parametrize("column", ["email", "nickname", "user_id", "Name"])
def test_개인을_가리킬_수_있는_열이_있으면_멈춘다(data: Path, file: str, column: str):
    add_column(data, file, column, "x")
    with pytest.raises(DataError, match="개인을 가리킬"):
        load_dataset(data, "P0")


def test_추천_학습에_동의하지_않은_사용자가_있으면_멈춘다(data: Path):
    mutate(data, "users.csv", "consent_recommendation", 1, "false")
    with pytest.raises(DataError, match="동의하지 않은"):
        load_dataset(data, "P0")


def test_공개되지_않은_곡이_있으면_멈춘다(data: Path):
    mutate(data, "songs.csv", "public", 0, "false")
    with pytest.raises(DataError, match="공개되지 않은"):
        load_dataset(data, "P0")


@pytest.mark.parametrize("key", ["12345678", "a@b.com", "short", "has space ok", "x" * 65])
def test_가명_키가_원래_계정_값처럼_보이면_멈춘다(data: Path, key: str):
    mutate(data, "users.csv", "user_key", 0, key)
    with pytest.raises(DataError):
        load_dataset(data, "P0")


def test_일반_사용자_데이터는_승인_근거_없이_쓸_수_없다(data: Path):
    with pytest.raises(DataError, match="P2"):
        load_dataset(data, "P2")
    with pytest.raises(DataError, match="P2"):
        load_dataset(data, "P2", p2_approval="  ")
    assert load_dataset(data, "P2", p2_approval="U2 해소: 약관 개정 v3").stage == "P2"


def test_모르는_출처_단계는_거부한다(data: Path):
    with pytest.raises(DataError, match="출처 단계"):
        load_dataset(data, "P9")


# ------------------------------------------------------------------ 로더: 스키마 위반


def test_필수_파일이_없으면_멈춘다(data: Path):
    (data / "chart_features.csv").unlink()
    with pytest.raises(DataError, match="필수 파일"):
        load_dataset(data, "P0")


def test_필수_열이_없거나_모르는_열이_있으면_멈춘다(data: Path):
    df = pd.read_csv(data / "songs.csv", dtype=str).drop(columns=["bpm"])
    df.to_csv(data / "songs.csv", index=False)
    with pytest.raises(DataError, match="필수 열"):
        load_dataset(data, "P0")
    make_dataset(data)
    add_column(data, "songs.csv", "extra", "1")
    with pytest.raises(DataError, match="스키마에 없는"):
        load_dataset(data, "P0")


def test_행이_없는_필수_파일은_멈춘다(data: Path):
    write_csv(
        data / "interactions.csv",
        ["user_key", "song_id", "chart_id", "played_at", "accuracy", "completed", "mode"],
        [],
    )
    with pytest.raises(DataError, match="행이 없습니다"):
        load_dataset(data, "P0")


@pytest.mark.parametrize(
    "file,column,row,value,message",
    [
        ("interactions.csv", "accuracy", 0, "101", "accuracy"),
        ("interactions.csv", "accuracy", 0, "-1", "accuracy"),
        ("interactions.csv", "accuracy", 0, "abc", "accuracy"),
        ("interactions.csv", "accuracy", 0, "nan", "accuracy"),
        ("interactions.csv", "accuracy", 0, "inf", "accuracy"),
        ("interactions.csv", "mode", 0, "FREE", "mode"),
        ("interactions.csv", "completed", 0, "maybe", "completed"),
        ("interactions.csv", "played_at", 0, "어제", "played_at"),
        ("interactions.csv", "user_key", 0, "user-zzzzzzzz", "users"),
        ("interactions.csv", "song_id", 0, "99", "songs"),
        ("interactions.csv", "chart_id", 0, "99", "chart_features"),
        ("interactions.csv", "chart_id", 0, "20", "다른 곡"),
        ("songs.csv", "bpm", 0, "0", "bpm"),
        ("songs.csv", "duration_ms", 0, "1.5", "duration_ms"),
        ("songs.csv", "song_level", 0, "EXPERT", "song_level"),
        ("songs.csv", "song_id", 1, "1", "중복"),
        ("chart_features.csv", "chart_id", 1, "10", "중복"),
        ("chart_features.csv", "song_id", 0, "99", "songs"),
        ("chart_features.csv", "difficulty", 0, "EXTREME", "difficulty"),
        ("chart_features.csv", "pad_ratio", 0, "[1,2]", "JSON 객체"),
        ("chart_features.csv", "pad_ratio", 0, "{broken", "JSON"),
        ("chart_features.csv", "pad_ratio", 0, '{"KICK": 1.5}', "0~1"),
        ("chart_features.csv", "rhythm_grid", 0, "{}", "groups 또는 excluded"),
        ("exposures.csv", "context", 0, "HOME", "context"),
        ("exposures.csv", "strategy", 0, "  ", "빈 값"),
        ("song_meta.csv", "genre", 0, "SYNTHWAVE", "genre"),
        ("song_meta.csv", "sub_genres", 0, "PUNK;POP;JAZZ", "최대 2개"),
        ("song_meta.csv", "mood", 0, "ANGRY", "mood"),
        ("song_meta.csv", "energy", 0, "6", "energy"),
        ("song_meta.csv", "language", 0, "FR", "language"),
        (
            "song_meta.csv",
            "drum_style",
            0,
            "EIGHT_BEAT;SHUFFLE;HALF_TIME;FOUR_ON_FLOOR",
            "최대 3개",
        ),
        ("weak_summary.csv", "avg_severity", 0, "1.2", "avg_severity"),
        ("weak_summary.csv", "count", 0, "0", "count"),
        ("weak_summary.csv", "user_key", 0, "user-zzzzzzzz", "users"),
    ],
)
def test_값이_스키마에_맞지_않으면_멈춘다(
    data: Path, file: str, column: str, row: int, value: str, message: str
):
    mutate(data, file, column, row, value)
    with pytest.raises(DataError, match=message):
        load_dataset(data, "P0")


def test_완전히_같은_연주_행이_중복되면_멈춘다(data: Path):
    df = pd.read_csv(data / "interactions.csv", dtype=str)
    pd.concat([df, df.iloc[[0]]]).to_csv(data / "interactions.csv", index=False)
    with pytest.raises(DataError, match="중복"):
        load_dataset(data, "P0")


# ------------------------------------------------------------------ 시간순 분할


def test_학습은_모두_cutoff_이전이고_시험_목표는_이후이다(data: Path):
    split = temporal_split(
        load_dataset(data, "P0").interactions, cutoff=pd.Timestamp("2026-10-09T00:00:00Z")
    )
    assert (split.train["played_at"] < split.cutoff).all()
    for test in (split.warm_test, split.cold_test):
        assert (test["played_at"] >= split.cutoff).all()
    assert split.train["played_at"].max() < min(
        split.warm_test["played_at"].min(), split.cold_test["played_at"].min()
    )


def test_사용자마다_cutoff_이후_첫_연주_하나가_목표이고_새_곡은_cold로_간다(data: Path):
    split = temporal_split(
        load_dataset(data, "P0").interactions, cutoff=pd.Timestamp("2026-10-09T00:00:00Z")
    )
    both = pd.concat([split.warm_test, split.cold_test])
    assert both["user_key"].is_unique and set(both["user_key"]) == {
        "user-aaaaaaaa",
        "user-bbbbbbbb",
        "user-cccccccc",
    }
    # 3번 곡은 학습 구간에 없었으므로 cccccccc의 목표(10-12)는 새 곡이다
    assert list(split.cold_test["song_id"]) == [3] and list(split.cold_test["user_key"]) == [
        "user-cccccccc"
    ]
    assert set(split.warm_test["user_key"]) == {"user-aaaaaaaa", "user-bbbbbbbb"}


def test_이미_친_곡이_목표이면_repeat로_표시한다(data: Path):
    split = temporal_split(
        load_dataset(data, "P0").interactions, cutoff=pd.Timestamp("2026-10-09T00:00:00Z")
    )
    repeat = dict(zip(split.warm_test["user_key"], split.warm_test["repeat"], strict=True))
    assert repeat["user-aaaaaaaa"] is True or repeat["user-aaaaaaaa"] == True  # noqa: E712 (1번 곡을 다시 침)
    assert repeat["user-bbbbbbbb"] == False  # noqa: E712 (2번 곡은 처음)


def test_학습_구간에_연주가_없는_사용자는_목표가_되지_않는다(tmp_path: Path):
    root = make_dataset(tmp_path / "d")
    mutate(
        root, "interactions.csv", "user_key", 5, "user-bbbbbbbb"
    )  # cccccccc의 첫 연주(10-04)를 bbbbbbbb로 → cccccccc는 이후 연주만 남음
    split = temporal_split(
        load_dataset(root, "P0").interactions, cutoff=pd.Timestamp("2026-10-09T00:00:00Z")
    )
    both = pd.concat([split.warm_test, split.cold_test])
    assert "user-cccccccc" not in set(both["user_key"])


def test_분할은_결정적이다(data: Path):
    inter = load_dataset(data, "P0").interactions
    a = temporal_split(inter, cutoff_quantile=0.6)
    b = temporal_split(
        inter.sample(frac=1, random_state=3), cutoff_quantile=0.6
    )  # 입력 행 순서가 달라도
    assert a.cutoff == b.cutoff
    for x, y in ((a.train, b.train), (a.warm_test, b.warm_test), (a.cold_test, b.cold_test)):
        assert set(zip(x["user_key"], x["song_id"], x["played_at"], strict=True)) == set(
            zip(y["user_key"], y["song_id"], y["played_at"], strict=True)
        )


def test_cutoff가_범위_밖이거나_분위수가_잘못되면_멈춘다(data: Path):
    inter = load_dataset(data, "P0").interactions
    with pytest.raises(DataError):
        temporal_split(inter, cutoff=pd.Timestamp("2027-01-01T00:00:00Z"))
    with pytest.raises(DataError):
        temporal_split(inter, cutoff=pd.Timestamp("2000-01-01T00:00:00Z"))
    with pytest.raises(DataError):
        temporal_split(inter, cutoff_quantile=1.0)
    with pytest.raises(DataError):
        temporal_split(inter.iloc[0:0])


def test_시각_없는_cutoff는_UTC로_본다(data: Path):
    inter = load_dataset(data, "P0").interactions
    assert temporal_split(inter, cutoff=pd.Timestamp("2026-10-09")).cutoff == pd.Timestamp(
        "2026-10-09T00:00:00Z"
    )


def test_무작위_데이터에서도_시간_누수가_없다():
    """속성 검사: 어떤 분위수로 나눠도 학습의 최대 시각 < 시험 목표의 최소 시각."""
    import numpy as np

    rng = np.random.default_rng(7)
    n = 400
    base = pd.Timestamp("2026-09-01T00:00:00Z")
    df = pd.DataFrame(
        {
            "user_key": [f"user-{i % 40:08d}" for i in range(n)],
            "song_id": rng.integers(1, 30, n),
            "chart_id": 1,
            "played_at": [
                base + pd.Timedelta(minutes=int(m)) for m in rng.integers(0, 60 * 24 * 40, n)
            ],
            "accuracy": 80.0,
            "completed": True,
            "mode": "RHYTHM",
        }
    )
    for q in (0.3, 0.5, 0.7, 0.9):
        s = temporal_split(df, cutoff_quantile=q)
        tests = pd.concat([s.warm_test, s.cold_test])
        assert s.train["played_at"].max() < s.cutoff <= tests["played_at"].min()
        assert tests["user_key"].is_unique and set(tests["user_key"]) <= set(s.train["user_key"])
