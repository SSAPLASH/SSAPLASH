"""ENST-Drums 로더 테스트. 테스트가 직접 만드는 짧은 wav·주석 파일만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.datasets import DatasetConfig, EnstDataset, load_dataset, validate_hits
from ssaplash_ai.bench.datasets.enst import (
    ENST_LABEL_PAD,
    label_pad_table,
    parse_song_id,
    song_kind,
)

# (드러머, 파일 이름, 주석)
SONGS = [
    (1, "107_minus-one_salsa_sticks", "0.1 bd\n0.1 cb\n0.4 mt\n0.7 lt\n0.9 mtr\n1.2 c1\n1.5 rc2\n"),
    (1, "003_hits_medium-tom_sticks_x5", "0.2 mt\n0.6 mt\n"),
    (2, "130_MIDI-minus-one_bigband_sticks", "0.1 sd-\n0.3 cs\n0.5 ohh\n0.8 spl2\n1.1 sweep\n"),
    (3, "107_minus-one_salsa_sticks", "0.1 mt\n0.3 lmt\n0.5 lt\n0.7 lft\n0.9 lmtr\n"),
    (3, "050_phrase_disco_sticks", "0.2 bd\n0.4 chh\n"),
]


def make_enst_root(root: Path, songs=SONGS) -> None:
    for drummer, name, ann in songs:
        base = root / f"drummer_{drummer}"
        (base / "annotation").mkdir(parents=True, exist_ok=True)
        (base / "annotation" / f"{name}.txt").write_text(ann, encoding="utf-8")
        write_wav(base / "audio" / "wet_mix" / f"{name}.wav", make_tone(2.0, SR, 220.0))
        if song_kind(name) in ("minus-one", "MIDI-minus-one"):
            write_wav(base / "audio" / "accompaniment" / f"{name}.wav", make_tone(2.0, SR, 110.0))


@pytest.fixture
def enst_root(tmp_path: Path) -> Path:
    root = tmp_path / "ENST-drums-public"
    make_enst_root(root)
    return root


def _config(root: Path, **kw) -> DatasetConfig:
    base = {"name": "fake_enst", "kind": "enst", "root": str(root)}
    base.update(kw)
    return DatasetConfig.from_dict(base)


def test_기본_subset은_반주_있는_곡만이고_드러머와_종류로_거른다(enst_root: Path):
    ds = load_dataset(_config(enst_root))
    assert isinstance(ds, EnstDataset)
    assert ds.song_ids() == [
        "drummer_1/107_minus-one_salsa_sticks",
        "drummer_2/130_MIDI-minus-one_bigband_sticks",
        "drummer_3/107_minus-one_salsa_sticks",
    ]
    assert ds.kind_of("drummer_2/130_MIDI-minus-one_bigband_sticks") == "MIDI-minus-one"
    assert ds.drummer_of("drummer_3/107_minus-one_salsa_sticks") == 3
    assert load_dataset(_config(enst_root, subset="all")).song_ids() == [
        "drummer_1/003_hits_medium-tom_sticks_x5",
        "drummer_1/107_minus-one_salsa_sticks",
        "drummer_2/130_MIDI-minus-one_bigband_sticks",
        "drummer_3/050_phrase_disco_sticks",
        "drummer_3/107_minus-one_salsa_sticks",
    ]
    assert load_dataset(
        _config(enst_root, subset="phrase", extra={"drummers": [3]})
    ).song_ids() == ["drummer_3/050_phrase_disco_sticks"]
    assert parse_song_id("drummer_2/x_phrase_y_z") == (2, "x_phrase_y_z")
    with pytest.raises(ValueError, match="drummer_N"):
        parse_song_id("no-slash")
    with pytest.raises(ValueError, match="종류"):
        song_kind("001_unknown_x_y")
    with pytest.raises(ValueError, match="subset"):
        load_dataset(_config(enst_root, subset="solos")).song_ids()


def test_load는_wet_mix를_드럼으로_반주는_게인을_곱해_더한다(enst_root: Path):
    ds = EnstDataset(_config(enst_root, extra={"accomp_gain": 0.5}))
    item = ds.load("drummer_1/107_minus-one_salsa_sticks")
    assert item.drums_true.shape == (2, 2 * SR) and item.mixture.shape == item.drums_true.shape
    np.testing.assert_allclose(item.accomp_true, make_tone(2.0, SR, 110.0) * 0.5, atol=2e-4)
    np.testing.assert_allclose(item.mixture, item.drums_true + item.accomp_true, atol=1e-6)
    np.testing.assert_allclose(item.onsets_true, [0.1, 0.1, 0.4, 0.7, 0.9, 1.2, 1.5])
    validate_hits(item.hits_true)
    # 드러머 1은 탐 둘: mt → MID_TOM, mtr(림)도 같은 탐. cb는 패드 밖
    assert item.hits_true["pad"].tolist() == [
        "KICK",
        "MID_TOM",
        "FLOOR_TOM",
        "MID_TOM",
        "CRASH",
        "RIDE",
    ]
    assert item.hits_dropped == 1 and (item.hits_true["velocity"] == -1).all()
    # 반주가 없는 종류는 무음 반주
    solo = EnstDataset(_config(enst_root, subset="phrase")).load(
        "drummer_3/050_phrase_disco_sticks"
    )
    assert not solo.accomp_true.any()
    np.testing.assert_allclose(solo.mixture, solo.drums_true)


def test_드러머_3의_탐_넷은_tom4_대응을_따른다(enst_root: Path):
    sid = "drummer_3/107_minus-one_salsa_sticks"
    default = EnstDataset(_config(enst_root)).load(sid).hits_true["pad"].tolist()
    assert default == ["SMALL_TOM", "MID_TOM", "FLOOR_TOM", "FLOOR_TOM", "MID_TOM"]
    two = EnstDataset(
        _config(
            enst_root,
            extra={
                "tom4": {"mt": "MID_TOM", "lmt": "MID_TOM", "lt": "FLOOR_TOM", "lft": "FLOOR_TOM"}
            },
        )
    ).load(sid)
    assert two.hits_true["pad"].tolist() == [
        "MID_TOM",
        "MID_TOM",
        "FLOOR_TOM",
        "FLOOR_TOM",
        "MID_TOM",
    ]
    # 드러머 1·2 표에는 lmt·lft가 없어 나오면 대응표 누락 오류
    assert "lmt" not in label_pad_table(1) and label_pad_table(1)["ltr"] == "FLOOR_TOM"
    assert label_pad_table(3)["lftr"] == "FLOOR_TOM"
    assert len(ENST_LABEL_PAD) == 21


def test_check는_패드별_타격_수를_세고_반주_누락을_잡는다(enst_root: Path):
    report = EnstDataset(_config(enst_root, expected_songs=3)).check()
    assert report.ok and report.song_count == 3
    # MID_TOM: 드러머 1의 mt·mtr 2개 + 드러머 3의 lmt·lmtr 2개
    assert report.hits_by_pad["MID_TOM"] == 4 and report.hits_by_pad["SNARE"] == 2
    assert report.hits_dropped == 2  # cb, sweep
    (enst_root / "drummer_2" / "audio" / "accompaniment").joinpath(
        "130_MIDI-minus-one_bigband_sticks.wav"
    ).unlink()
    report = EnstDataset(_config(enst_root, expected_songs=3)).check()
    assert report.missing == [
        "drummer_2/130_MIDI-minus-one_bigband_sticks/130_MIDI-minus-one_bigband_sticks.wav"
    ]
    assert not report.ok


def test_대응표에_없는_라벨은_오류(enst_root: Path):
    ann = enst_root / "drummer_1" / "annotation" / "107_minus-one_salsa_sticks.txt"
    ann.write_text("0.1 gong\n", encoding="utf-8")
    with pytest.raises(ValueError, match="대응표에 없는 라벨"):
        EnstDataset(_config(enst_root)).load("drummer_1/107_minus-one_salsa_sticks")
