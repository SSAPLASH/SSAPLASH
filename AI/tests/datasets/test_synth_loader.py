"""합성곡 로더 테스트. 테스트용 합성곡 폴더만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.datasets import DatasetConfig, SynthDataset, validate_hits

ONSETS = [0.1, 0.5, 1.2, 1.9]
# 온셋 순서대로 (피치, gmd_class, 세기). 마지막은 패드에 없는 타격
CLASSES = [(36, "kick", 100), (38, "snare", 90), (46, "hihat_open", 70), (56, "other", 60)]


def make_synth_song(song_dir: Path, seconds: float = 2.0) -> None:
    drums = make_tone(seconds, SR, 220.0)
    accomp = make_tone(seconds, SR, 110.0) * 0.5
    write_wav(song_dir / "drums.wav", drums)
    write_wav(song_dir / "accomp.wav", accomp)
    write_wav(song_dir / "mixture.wav", drums + accomp)
    lines = ["time_sec,pitch,gmd_class,velocity"] + [
        f"{t:.6f},{p},{c},{v}" for t, (p, c, v) in zip(ONSETS, CLASSES, strict=True)
    ]
    (song_dir / "onsets.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (song_dir / "meta.yaml").write_text("name: s\n", encoding="utf-8")


@pytest.fixture
def synth_root(tmp_path: Path) -> Path:
    root = tmp_path / "synth_v1"
    make_synth_song(root / "song_1")
    make_synth_song(root / "song_2")
    return root


def _config(root: Path, **kw) -> DatasetConfig:
    base = {"name": "fake_synth", "kind": "synth", "root": str(root)}
    base.update(kw)
    return DatasetConfig.from_dict(base)


def test_load는_온셋을_초_단위_배열로_준다(synth_root: Path):
    item = SynthDataset(_config(synth_root)).load("song_1")
    assert item.mixture.shape == (2, 2 * SR)
    np.testing.assert_allclose(item.onsets_true, ONSETS)
    np.testing.assert_allclose(item.accomp_true, item.mixture - item.drums_true, atol=1e-7)


def test_clip은_온셋도_같이_자르고_시작점을_0으로_옮긴다(synth_root: Path):
    item = SynthDataset(_config(synth_root, clip=[0.4, 1.5])).load("song_1")
    assert item.mixture.shape[1] == int(1.1 * SR)
    np.testing.assert_allclose(item.onsets_true, [0.1, 0.8])
    np.testing.assert_allclose(item.hits_true["time_sec"], [0.1, 0.8])
    assert item.hits_true["pad"].tolist() == ["SNARE", "HIHAT"]


def test_load는_타격_표를_패드로_변환하고_패드_밖_타격은_뺀다(synth_root: Path):
    item = SynthDataset(_config(synth_root)).load("song_1")
    validate_hits(item.hits_true)
    assert item.hits_true["pad"].tolist() == ["KICK", "SNARE", "HIHAT"]
    assert item.hits_true["velocity"].tolist() == [100, 90, 70]
    assert item.hits_dropped == 1
    # onsets_true는 패드 밖 타격까지 전부
    assert len(item.onsets_true) == 4


def test_check는_패드별_타격_수를_합산한다(synth_root: Path):
    report = SynthDataset(_config(synth_root, expected_songs=2)).check()
    assert report.ok
    assert report.hits_by_pad["KICK"] == 2
    assert report.hits_by_pad["SNARE"] == 2
    assert report.hits_by_pad["RIDE"] == 0
    assert report.hits_dropped == 2


def test_모르는_gmd_class는_오류(synth_root: Path):
    csv_path = synth_root / "song_1" / "onsets.csv"
    csv_path.write_text("time_sec,pitch,gmd_class,velocity\n0.1,99,gong,50\n", encoding="utf-8")
    with pytest.raises(ValueError, match="대응표에 없는 라벨"):
        SynthDataset(_config(synth_root)).load("song_1")


def test_check는_다섯_파일_중_빠진_것을_보고한다(synth_root: Path):
    (synth_root / "song_2" / "meta.yaml").unlink()
    (synth_root / "song_2" / "onsets.csv").unlink()
    report = SynthDataset(_config(synth_root, expected_songs=2)).check()
    assert report.song_count == 2
    assert report.total_duration_sec == pytest.approx(4.0)
    assert report.missing == ["song_2/onsets.csv", "song_2/meta.yaml"]
    assert not report.ok


def test_폴더가_없으면_곡이_0개다(tmp_path: Path):
    ds = SynthDataset(_config(tmp_path / "없음", expected_songs=5))
    assert ds.song_ids() == []
    assert not ds.check().ok
