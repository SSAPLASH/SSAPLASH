"""합성곡 로더 테스트. 가짜 합성곡 폴더만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.datasets import DatasetConfig, SynthDataset

ONSETS = [0.1, 0.5, 1.2, 1.9]


def make_synth_song(song_dir: Path, seconds: float = 2.0) -> None:
    drums = make_tone(seconds, SR, 220.0)
    accomp = make_tone(seconds, SR, 110.0) * 0.5
    write_wav(song_dir / "drums.wav", drums)
    write_wav(song_dir / "accomp.wav", accomp)
    write_wav(song_dir / "mixture.wav", drums + accomp)
    lines = ["time_sec,pitch,gmd_class,velocity"] + [f"{t:.6f},36,kick,100" for t in ONSETS]
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
