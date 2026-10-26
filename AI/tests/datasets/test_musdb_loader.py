"""MUSDB18-HQ 로더와 오디오 공용 함수 테스트. 테스트용 wav 폴더만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.datasets import DatasetConfig, MusdbDataset, load_dataset
from ssaplash_ai.bench.datasets.base import match_length, read_audio
from ssaplash_ai.bench.datasets.musdb import read_accompaniment_stems


def _config(root: Path, **kw) -> DatasetConfig:
    base = {"name": "fake_musdb", "kind": "musdb", "root": str(root), "subset": "test"}
    base.update(kw)
    return DatasetConfig.from_dict(base)


def test_곡_목록은_폴더_이름을_정렬해_돌려준다(musdb_root: Path):
    ds = MusdbDataset(_config(musdb_root))
    assert ds.song_ids() == ["Song A", "Song B"]
    assert len(ds) == 2


def test_songs_설정이_있으면_그_목록만_쓴다(musdb_root: Path):
    ds = MusdbDataset(_config(musdb_root, songs=["Song B"]))
    assert ds.song_ids() == ["Song B"]


def test_load는_설계_3_1_필드를_채운다(musdb_root: Path):
    item = MusdbDataset(_config(musdb_root)).load("Song A")
    assert item.dataset == "fake_musdb"
    assert item.song_id == "Song A"
    assert item.sample_rate == SR
    assert item.mixture.shape == (2, SR)
    assert item.mixture.dtype == np.float32
    assert item.drums_true.shape == item.mixture.shape
    assert item.accomp_true.shape == item.mixture.shape
    assert item.onsets_true is None
    assert item.clip is None
    assert item.duration_sec == pytest.approx(1.0)


def test_정답_반주는_원곡에서_정답_드럼을_뺀_것이다(musdb_root: Path):
    item = MusdbDataset(_config(musdb_root)).load("Song A")
    np.testing.assert_allclose(item.accomp_true, item.mixture - item.drums_true, atol=1e-7)
    # bass+other+vocals 합과도 16비트 양자화 오차 안에서 일치
    stems_sum = read_accompaniment_stems(musdb_root / "test" / "Song A", SR)
    np.testing.assert_allclose(item.accomp_true, stems_sum, atol=2e-4)


def test_clip은_지정_구간만_읽는다(musdb_root: Path):
    item = MusdbDataset(_config(musdb_root, clip=[0.5, 1.0])).load("Song B")
    assert item.mixture.shape[1] == SR // 2
    assert item.clip == (0.5, 1.0)


def test_check는_곡_수_길이_누락을_보고한다(musdb_root: Path):
    (musdb_root / "test" / "Song B" / "drums.wav").unlink()
    report = MusdbDataset(_config(musdb_root, expected_songs=2)).check()
    assert report.song_count == 2
    assert report.total_duration_sec == pytest.approx(3.0)
    assert report.missing == ["Song B/drums.wav"]
    assert not report.ok


def test_check는_기대_곡_수와_다르면_실패다(musdb_root: Path):
    report = MusdbDataset(_config(musdb_root, expected_songs=50)).check()
    assert report.missing == []
    assert not report.ok
    assert MusdbDataset(_config(musdb_root, expected_songs=2)).check().ok


def test_subset이_없으면_거부한다(musdb_root: Path):
    with pytest.raises(ValueError):
        MusdbDataset(_config(musdb_root, subset=None))


def test_load_dataset은_yaml로_로더를_만든다(musdb_root: Path, tmp_path: Path):
    yaml_path = tmp_path / "ds.yaml"
    yaml_path.write_text(
        f"name: y\nkind: musdb\nroot: {musdb_root.as_posix()}\nsubset: test\nexpected_songs: 2\n",
        encoding="utf-8",
    )
    ds = load_dataset(yaml_path)
    assert isinstance(ds, MusdbDataset)
    assert ds.check().ok


def test_모르는_kind는_거부한다(musdb_root: Path):
    with pytest.raises(ValueError):
        load_dataset(_config(musdb_root, kind="nope"))


def test_read_audio는_모노와_다른_샘플레이트를_스테레오_44100으로_맞춘다(tmp_path: Path):
    path = tmp_path / "mono22k.wav"
    write_wav(path, make_tone(1.0, sr=22050, channels=1), sr=22050)
    audio = read_audio(path, SR)
    assert audio.shape == (2, SR)
    assert audio.dtype == np.float32
    np.testing.assert_array_equal(audio[0], audio[1])


def test_match_length는_가장_짧은_길이에_맞춘다():
    a, b = match_length(np.zeros((2, 10)), np.zeros((2, 7)))
    assert a.shape == b.shape == (2, 7)
