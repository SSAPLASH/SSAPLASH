"""MDB Drums 로더 테스트. 테스트용 wav·주석 파일만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.datasets import DatasetConfig, MdbDataset, validate_hits
from ssaplash_ai.bench.datasets.mdb import MDB_IN_MUSDB_TRAIN, MDB_SUBCLASS_PAD

# 원본 주석과 같은 꼴: "시각 \t 라벨 " (탭 양옆 공백). TMB는 패드 밖
ANNOTATION = (
    "0.270000 \t KD \n0.410000 \t CHH \n0.810000 \t SDG \n1.200000 \t RDB \n1.500000 \t TMB \n"
)


def make_mdb_root(root: Path, names: list[str], seconds: float = 2.0) -> None:
    for name in names:
        drums = make_tone(seconds, SR, 220.0)
        accomp = make_tone(seconds, SR, 110.0) * 0.5
        write_wav(root / "audio" / "drum_only" / f"{name}_Drum.wav", drums)
        write_wav(root / "audio" / "full_mix" / f"{name}_MIX.wav", drums + accomp)
        ann = root / "annotations" / "subclass" / f"{name}_subclass.txt"
        ann.parent.mkdir(parents=True, exist_ok=True)
        ann.write_text(ANNOTATION, encoding="utf-8")


@pytest.fixture
def mdb_root(tmp_path: Path) -> Path:
    root = tmp_path / "MDB Drums"
    make_mdb_root(root, ["MusicDelta_Fake1", "MusicDelta_Fake2"])
    return root


def _config(root: Path, **kw) -> DatasetConfig:
    base = {"name": "fake_mdb", "kind": "mdb", "root": str(root)}
    base.update(kw)
    return DatasetConfig.from_dict(base)


def test_songs가_없으면_full_mix_폴더에서_찾는다(mdb_root: Path):
    assert MdbDataset(_config(mdb_root)).song_ids() == ["MusicDelta_Fake1", "MusicDelta_Fake2"]


def test_load는_원곡_드럼_주석을_준다(mdb_root: Path):
    item = MdbDataset(_config(mdb_root)).load("MusicDelta_Fake1")
    assert item.mixture.shape == (2, 2 * SR)
    np.testing.assert_allclose(item.accomp_true, item.mixture - item.drums_true, atol=1e-7)
    np.testing.assert_allclose(item.onsets_true, [0.27, 0.41, 0.81, 1.2, 1.5])
    validate_hits(item.hits_true)
    assert item.hits_true["pad"].tolist() == ["KICK", "HIHAT", "SNARE", "RIDE"]
    assert item.hits_true["velocity"].tolist() == [-1, -1, -1, -1]
    assert item.hits_dropped == 1


def test_check는_패드별_타격_수를_센다(mdb_root: Path):
    report = MdbDataset(_config(mdb_root, expected_songs=2)).check()
    assert report.ok
    assert report.hits_by_pad["SNARE"] == 2 and report.hits_by_pad["CRASH"] == 0
    assert report.hits_dropped == 2


def test_주석_파일이_없으면_누락(mdb_root: Path):
    (mdb_root / "annotations" / "subclass" / "MusicDelta_Fake2_subclass.txt").unlink()
    report = MdbDataset(_config(mdb_root, expected_songs=2)).check()
    assert report.missing == ["MusicDelta_Fake2/MusicDelta_Fake2_subclass.txt"]
    assert not report.ok


def test_모르는_라벨은_오류(mdb_root: Path):
    ann = mdb_root / "annotations" / "subclass" / "MusicDelta_Fake1_subclass.txt"
    ann.write_text("0.1 \t GONG \n", encoding="utf-8")
    with pytest.raises(ValueError, match="대응표에 없는 라벨"):
        MdbDataset(_config(mdb_root)).load("MusicDelta_Fake1")


def test_대응표는_21종이고_MUSDB_겹침은_12곡():
    assert len(MDB_SUBCLASS_PAD) == 21
    assert len(MDB_IN_MUSDB_TRAIN) == 12
