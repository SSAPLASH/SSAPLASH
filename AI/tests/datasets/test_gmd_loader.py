"""GMD 연주 로더 테스트. 테스트용 info.csv·wav·mid만 사용."""

from __future__ import annotations

from pathlib import Path

import mido
import numpy as np
import pytest

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.datasets import DatasetConfig, GmdDataset, validate_hits

# (시각 초, 피치, 세기). 56은 카우벨이라 패드 밖
NOTES = [(0.1, 36, 100), (0.5, 38, 90), (1.2, 42, 70), (1.9, 56, 60)]


def write_midi(path: Path, notes: list[tuple[float, int, int]], bpm: float = 120.0) -> None:
    mid = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    last_tick = 0
    for t, pitch, vel in notes:
        tick = int(round(mido.second2tick(t, 480, mido.bpm2tempo(bpm))))
        track.append(mido.Message("note_on", note=pitch, velocity=vel, time=tick - last_tick))
        track.append(mido.Message("note_off", note=pitch, velocity=0, time=0))
        last_tick = tick
    path.parent.mkdir(parents=True, exist_ok=True)
    mid.save(str(path))


COLUMNS = "drummer,session,id,style,bpm,beat_type,time_signature,midi_filename,audio_filename,duration,split"


def make_gmd_root(root: Path) -> None:
    rows = [
        ("drummer1/s1/1", "rock", "beat", "test", 2.0),
        ("drummer1/s1/2", "funk", "beat", "test", 2.0),
        ("drummer1/s1/3", "rock", "fill", "test", 2.0),
        ("drummer1/s1/4", "rock", "beat", "train", 2.0),
    ]
    lines = [COLUMNS]
    for sid, style, beat_type, split, dur in rows:
        base = f"{sid}_{style}"
        lines.append(
            f"drummer1,drummer1/s1,{sid},{style},120,{beat_type},4-4,{base}.mid,{base}.wav,{dur},{split}"
        )
        write_wav(root / f"{base}.wav", make_tone(dur, SR, 220.0, channels=1))
        write_midi(root / f"{base}.mid", NOTES)
    (root / "info.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.fixture
def gmd_root(tmp_path: Path) -> Path:
    root = tmp_path / "groove"
    make_gmd_root(root)
    return root


def _config(root: Path, **kw) -> DatasetConfig:
    base = {"name": "fake_gmd", "kind": "gmd", "root": str(root)}
    base.update(kw)
    return DatasetConfig.from_dict(base)


def test_songs가_없으면_test_split_beat만(gmd_root: Path):
    assert GmdDataset(_config(gmd_root)).song_ids() == ["drummer1/s1/1", "drummer1/s1/2"]


def test_load는_드럼_트랙과_MIDI_타격을_준다(gmd_root: Path):
    item = GmdDataset(_config(gmd_root, songs=["drummer1/s1/1"])).load("drummer1/s1/1")
    assert item.mixture.shape == (2, 2 * SR)
    np.testing.assert_array_equal(item.mixture, item.drums_true)
    assert not item.accomp_true.any()
    np.testing.assert_allclose(item.onsets_true, [t for t, _, _ in NOTES], atol=2e-3)
    validate_hits(item.hits_true)
    assert item.hits_true["pad"].tolist() == ["KICK", "SNARE", "HIHAT"]
    assert item.hits_true["velocity"].tolist() == [100, 90, 70]
    assert item.hits_dropped == 1


def test_clip은_타격도_자른다(gmd_root: Path):
    item = GmdDataset(_config(gmd_root, songs=["drummer1/s1/1"], clip=[0.4, 1.5])).load(
        "drummer1/s1/1"
    )
    assert item.hits_true["pad"].tolist() == ["SNARE", "HIHAT"]
    np.testing.assert_allclose(item.hits_true["time_sec"], [0.1, 0.8], atol=2e-3)


def test_check는_패드별_타격_수를_센다(gmd_root: Path):
    report = GmdDataset(_config(gmd_root, expected_songs=2)).check()
    assert report.ok
    assert report.song_count == 2
    assert report.hits_by_pad["KICK"] == 2 and report.hits_by_pad["CRASH"] == 0
    assert report.hits_dropped == 2


def test_모르는_id는_info_csv_누락으로_보고(gmd_root: Path):
    report = GmdDataset(_config(gmd_root, songs=["drummer9/x/99"])).check()
    assert report.missing == ["drummer9/x/99/missing-in-info.csv"]
    assert not report.ok


def test_info_csv가_없으면_곡이_0개(tmp_path: Path):
    assert GmdDataset(_config(tmp_path / "없음")).song_ids() == []


def test_export_subset은_songs의_파일만_복사한다(gmd_root: Path, tmp_path: Path):
    from ssaplash_ai.bench.datasets.gmd import export_subset

    ds = GmdDataset(_config(gmd_root, songs=["drummer1/s1/1"]))
    out = tmp_path / "upload" / "groove"
    copied = export_subset(ds, out)
    rel = sorted(p.relative_to(out).as_posix() for p in copied)
    assert rel == ["drummer1/s1/1_rock.mid", "drummer1/s1/1_rock.wav", "info.csv"]
    assert not (out / "drummer1/s1/2_funk.wav").exists()
    report = GmdDataset(_config(out, songs=["drummer1/s1/1"])).check()
    assert report.song_count == 1 and report.missing == []


def test_export_subset은_빠진_파일이면_오류(gmd_root: Path, tmp_path: Path):
    from ssaplash_ai.bench.datasets.gmd import export_subset

    (gmd_root / "drummer1/s1/2_funk.mid").unlink()
    ds = GmdDataset(_config(gmd_root, songs=["drummer1/s1/2"]))
    with pytest.raises(FileNotFoundError, match="drummer1/s1/2"):
        export_subset(ds, tmp_path / "out")
