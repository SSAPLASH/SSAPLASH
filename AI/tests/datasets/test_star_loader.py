"""STAR Drums 로더 테스트. 테스트가 직접 만드는 짧은 flac·주석 파일만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from helpers import SR, make_tone
from ssaplash_ai.bench.datasets import DatasetConfig, StarDataset, load_dataset, validate_hits
from ssaplash_ai.bench.datasets.star import STAR_CLASS_PAD, split_song_id

# 원본 주석과 같은 꼴: "초 \t 클래스 \t MIDI 세기". CL(클랩)은 패드 밖
ANNOTATION = (
    "0.01\tBD\t120\n0.01\tMT\t123\n0.54\tSD\t119\n0.54\tHT\t122\n1.2\tLT\t90\n1.5\tCL\t100\n"
)
KIT = "ar_80s_black_kit_full"


def _flac(path: Path, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio.T, SR, format="FLAC")


def make_star_root(root: Path, items: list[str], subset: str = "test", with_mix=True) -> None:
    split = root / subset
    for item in items:
        drums = make_tone(2.0, SR, 220.0)
        accomp = make_tone(2.0, SR, 110.0) * 0.5
        _flac(split / "audio" / "re_synthesized_drum" / f"{item}_re_synth_drum_{KIT}.flac", drums)
        _flac(split / "audio" / "non_drum" / f"{item}_non_drum.flac", accomp)
        if with_mix:
            _flac(split / "audio" / "mix" / f"{item}_mix_{KIT}.flac", drums + accomp)
        ann = split / "annotation" / f"{item}_mix_{KIT}.txt"
        ann.parent.mkdir(parents=True, exist_ok=True)
        ann.write_text(ANNOTATION, encoding="utf-8")


@pytest.fixture
def star_root(tmp_path: Path) -> Path:
    root = tmp_path / "data"
    make_star_root(root, ["Song_A", "Song_B"])
    return root


def _config(root: Path, **kw) -> DatasetConfig:
    base = {"name": "fake_star", "kind": "star", "root": str(root), "subset": "test"}
    base.update(kw)
    return DatasetConfig.from_dict(base)


def test_songs가_없으면_annotation_폴더에서_찾고_킷_이름을_뗀다(star_root: Path):
    ds = load_dataset(_config(star_root))
    assert isinstance(ds, StarDataset)
    assert ds.song_ids() == [f"Song_A_mix_{KIT}", f"Song_B_mix_{KIT}"]
    assert ds.kit_of(f"Song_A_mix_{KIT}") == KIT
    assert split_song_id("x_mix_kit_one") == ("x", "kit_one")
    with pytest.raises(ValueError, match="_mix_"):
        split_song_id("no_tag")


def test_load는_합성_드럼_반주_원곡_주석을_준다(star_root: Path):
    item = StarDataset(_config(star_root)).load(f"Song_A_mix_{KIT}")
    assert item.mixture.shape == (2, 2 * SR) and item.drums_true.shape == item.mixture.shape
    np.testing.assert_allclose(item.mixture, item.drums_true + item.accomp_true, atol=2e-4)
    np.testing.assert_allclose(item.onsets_true, [0.01, 0.01, 0.54, 0.54, 1.2, 1.5])
    validate_hits(item.hits_true)
    assert item.hits_true["pad"].tolist() == ["KICK", "MID_TOM", "SNARE", "SMALL_TOM", "FLOOR_TOM"]
    assert item.hits_true["velocity"].tolist() == [120, 123, 119, 122, 90]
    assert item.hits_dropped == 1


def test_믹스가_없으면_드럼과_반주를_더해_원곡으로_쓴다(tmp_path: Path):
    root = tmp_path / "data"
    make_star_root(root, ["Song_C"], subset="validation", with_mix=False)
    ds = StarDataset(_config(root, subset="validation", expected_songs=1))
    assert ds.check().ok
    item = ds.load(f"Song_C_mix_{KIT}")
    np.testing.assert_allclose(item.mixture, item.drums_true + item.accomp_true, atol=1e-6)


def test_check는_패드별_타격_수를_세고_누락을_잡는다(star_root: Path):
    report = StarDataset(_config(star_root, expected_songs=2)).check()
    assert report.ok
    assert report.hits_by_pad["MID_TOM"] == 2 and report.hits_by_pad["CRASH"] == 0
    assert report.hits_dropped == 2
    (star_root / "test" / "audio" / "non_drum" / "Song_B_non_drum.flac").unlink()
    report = StarDataset(_config(star_root, expected_songs=2)).check()
    assert report.missing == [f"Song_B_mix_{KIT}/Song_B_non_drum.flac"] and not report.ok


def test_대응표는_18종이고_모르는_클래스는_오류(star_root: Path):
    assert len(STAR_CLASS_PAD) == 18
    assert STAR_CLASS_PAD["PHH"] == "HIHAT_PEDAL"
    assert STAR_CLASS_PAD["CHH"] == STAR_CLASS_PAD["OHH"] == "HIHAT"
    assert {STAR_CLASS_PAD[c] for c in ("HT", "MT", "LT")} == {"SMALL_TOM", "MID_TOM", "FLOOR_TOM"}
    ann = star_root / "test" / "annotation" / f"Song_A_mix_{KIT}.txt"
    ann.write_text("0.1\tGONG\t100\n", encoding="utf-8")
    with pytest.raises(ValueError, match="대응표에 없는 라벨"):
        StarDataset(_config(star_root)).load(f"Song_A_mix_{KIT}")
