"""E-GMD 로더 테스트. 테스트가 직접 만드는 csv·wav·MIDI만 사용."""

from __future__ import annotations

from pathlib import Path

import mido

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.datasets import DatasetConfig, EgmdDataset, load_dataset
from ssaplash_ai.bench.datasets.gmd import EGMD_CSV

ROWS = [
    # (id, split, beat_type, kit, 파일 번호)
    ("drummer1/eval_session/1", "test", "beat", "Acoustic Kit", 1),
    ("drummer1/eval_session/1", "test", "beat", "808 Simple", 2),
    ("drummer1/eval_session/2", "test", "beat", "Acoustic Kit", 1),
    ("drummer1/eval_session/2", "test", "fill", "Acoustic Kit", 1),
    ("drummer1/session1/3", "train", "beat", "Acoustic Kit", 1),
]


def make_egmd_root(root: Path) -> None:
    lines = [
        "drummer,session,id,style,bpm,beat_type,time_signature,duration,split,midi_filename,audio_filename,kit_name"
    ]
    for pid, split, bt, kit, n in ROWS:
        stem = f"{pid}_rock_120_{bt}_4-4_{n}"
        lines.append(
            f"drummer1,{pid.rsplit('/', 1)[0]},{pid},rock,120,{bt},4-4,1.0,{split},{stem}.midi,{stem}.wav,{kit}"
        )
        write_wav(root / f"{stem}.wav", make_tone(1.0, SR, 220.0))
        m = mido.MidiFile()
        tr = mido.MidiTrack()
        m.tracks.append(tr)
        tr.append(mido.Message("note_on", note=48, velocity=90, time=0))  # SMALL_TOM
        tr.append(mido.Message("note_off", note=48, velocity=0, time=240))
        (root / f"{stem}.midi").parent.mkdir(parents=True, exist_ok=True)
        m.save(str(root / f"{stem}.midi"))
    root.mkdir(parents=True, exist_ok=True)
    (root / EGMD_CSV).write_text("\n".join(lines) + "\n", encoding="utf-8")


def _config(root: Path, **kw) -> DatasetConfig:
    base = {"name": "fake_egmd", "kind": "egmd", "root": str(root), "subset": "test"}
    base.update(kw)
    return DatasetConfig.from_dict(base)


def test_곡_id는_오디오_이름이고_split_beat_연주_킷으로_거른다(tmp_path: Path):
    make_egmd_root(tmp_path)
    ds = load_dataset(_config(tmp_path))
    assert isinstance(ds, EgmdDataset)
    # test·beat만: 연주 2개 × 킷 (1번 연주는 킷 2개)
    assert ds.song_ids() == [
        "drummer1/eval_session/1_rock_120_beat_4-4_1",
        "drummer1/eval_session/1_rock_120_beat_4-4_2",
        "drummer1/eval_session/2_rock_120_beat_4-4_1",
    ]
    ds = load_dataset(
        _config(tmp_path, extra={"kits": ["Acoustic Kit"], "perf_ids": ["drummer1/eval_session/1"]})
    )
    assert ds.song_ids() == ["drummer1/eval_session/1_rock_120_beat_4-4_1"]
    assert ds.kit_of(ds.song_ids()[0]) == "Acoustic Kit"
    assert ds.perf_of(ds.song_ids()[0]) == "drummer1/eval_session/1"
    assert load_dataset(_config(tmp_path, subset="train")).song_ids() == [
        "drummer1/session1/3_rock_120_beat_4-4_1"
    ]


def test_load와_check는_GMD와_같이_동작한다(tmp_path: Path):
    make_egmd_root(tmp_path)
    ds = EgmdDataset(_config(tmp_path, expected_songs=3))
    report = ds.check()
    assert report.ok and report.hits_by_pad["SMALL_TOM"] == 3
    item = ds.load("drummer1/eval_session/1_rock_120_beat_4-4_2")
    assert item.hits_true["pad"].tolist() == ["SMALL_TOM"] and item.mixture.shape == (2, SR)
    assert DatasetConfig.from_dict({"name": "x", "kind": "egmd", "root": "r"}).extra == {}
