"""합성곡 제작 로직 테스트. 가짜 GMD(info.csv·MIDI·wav)와 가짜 MUSDB train 곡 사용."""

from __future__ import annotations

from pathlib import Path

import mido
import numpy as np
import pytest
import yaml

from helpers import SR, make_musdb_song, make_tone, write_wav
from ssaplash_ai.bench.datasets import SynthDataset
from ssaplash_ai.bench.datasets.base import DatasetConfig
from ssaplash_ai.bench.datasets.synth_build import (
    Recipe,
    SongRecipe,
    build_all,
    fade_edges,
    list_gmd,
    midi_onsets,
)

# 120bpm에서 4분음표 간격 → 0, 0.5, 1.0, 1.5초. 마지막은 세기 0이라 온셋 아님.
NOTES = [(36, 100), (38, 90), (42, 80), (36, 0)]


def write_midi(path: Path) -> None:
    mid = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(120)))
    for i, (pitch, vel) in enumerate(NOTES):
        track.append(mido.Message("note_on", note=pitch, velocity=vel, time=0 if i == 0 else 480))
        track.append(mido.Message("note_off", note=pitch, velocity=0, time=0))
    path.parent.mkdir(parents=True, exist_ok=True)
    mid.save(str(path))


@pytest.fixture
def fake_gmd(tmp_path: Path) -> Path:
    root = tmp_path / "groove"
    rows = [
        # id, style, bpm, beat_type, duration, audio 있음
        ("drummer1/session1/1", "rock", 90, "beat", 3.0, True),
        ("drummer1/session1/2", "funk", 120, "beat", 1.0, True),
        ("drummer1/session1/3", "rock", 140, "fill", 2.0, True),
        ("drummer2/session1/1", "jazz", 100, "beat", 5.0, False),
    ]
    lines = [
        "drummer,session,id,style,bpm,beat_type,time_signature,midi_filename,audio_filename,duration,split"
    ]
    for rid, style, bpm, bt, dur, has_audio in rows:
        stem = rid.replace("/", "_")
        midi = f"{rid.rsplit('/', 1)[0]}/{stem}.mid"
        audio = f"{rid.rsplit('/', 1)[0]}/{stem}.wav" if has_audio else ""
        write_midi(root / midi)
        if has_audio:
            write_wav(root / audio, make_tone(dur, SR, 200.0, channels=1))
        lines.append(
            f"{rid.split('/')[0]},session1,{rid},{style},{bpm},{bt},4-4,{midi},{audio},{dur},train"
        )
    (root / "info.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return root


@pytest.fixture
def fake_musdb_train(tmp_path: Path) -> Path:
    root = tmp_path / "musdb18hq"
    make_musdb_song(root / "train" / "Train Song", 10.0)
    return root


def test_midi_onsets는_세기가_있는_note_on만_초_단위로_뽑는다(fake_gmd: Path):
    onsets = midi_onsets(fake_gmd / "drummer1/session1/drummer1_session1_1.mid")
    assert [round(t, 6) for t, _, _ in onsets] == [0.0, 0.5, 1.0]
    assert [p for _, p, _ in onsets] == [36, 38, 42]


def test_list_gmd는_오디오가_있는_beat만_조건으로_거른다(fake_gmd: Path):
    assert [r["id"] for r in list_gmd(fake_gmd)] == ["drummer1/session1/2", "drummer1/session1/1"]
    assert [r["id"] for r in list_gmd(fake_gmd, style="rock")] == ["drummer1/session1/1"]
    assert list_gmd(fake_gmd, bpm_min=100, bpm_max=130)[0]["id"] == "drummer1/session1/2"
    assert list_gmd(fake_gmd, min_sec=2.0, beat_type=None) == list_gmd(
        fake_gmd, min_sec=2.0, beat_type=None
    )
    assert len(list_gmd(fake_gmd, beat_type=None)) == 3


def test_fade_edges는_양_끝만_줄이고_가운데는_그대로다():
    audio = np.ones((2, SR), dtype=np.float32)
    out = fade_edges(audio, SR, fade_ms=20.0)
    assert out[0, 0] == 0.0
    assert out[0, -1] == 0.0
    assert out[0, SR // 2] == 1.0
    assert audio[0, 0] == 1.0  # 원본은 그대로


def test_build는_다섯_산출물을_만들고_원곡은_드럼과_반주의_합이다(
    fake_gmd: Path, fake_musdb_train: Path, tmp_path: Path
):
    recipe = Recipe(
        version="test",
        gmd_root=fake_gmd,
        musdb_root=fake_musdb_train,
        output_root=tmp_path / "out",
        sample_rate=SR,
        songs=[
            SongRecipe(
                name="rock_90",
                gmd_id="drummer1/session1/1",
                musdb_song="train/Train Song",
                accomp_start_sec=2.0,
                duration_sec=2.0,
                drums_gain_db=0.0,
                accomp_gain_db=-6.0,
            )
        ],
    )
    outputs = build_all(recipe)
    assert outputs == [tmp_path / "out" / "rock_90"]
    out = outputs[0]
    for name in ("mixture.wav", "drums.wav", "accomp.wav", "onsets.csv", "meta.yaml"):
        assert (out / name).is_file(), name

    item = SynthDataset(
        DatasetConfig.from_dict({"name": "t", "kind": "synth", "root": str(tmp_path / "out")})
    ).load("rock_90")
    assert item.mixture.shape == (2, 2 * SR)
    # 24비트 저장이라 합 관계는 양자화 오차 안에서 유지
    np.testing.assert_allclose(item.accomp_true, item.mixture - item.drums_true, atol=1e-7)
    assert float(np.max(np.abs(item.mixture))) <= 0.99 + 1e-4
    # 2초 안의 온셋 3개 (0, 0.5, 1.0)
    np.testing.assert_allclose(item.onsets_true, [0.0, 0.5, 1.0])

    meta = yaml.safe_load((out / "meta.yaml").read_text(encoding="utf-8"))
    assert meta["drums"]["license"] == "CC BY 4.0"
    assert "상업" in meta["accomp"]["license"]
    assert meta["drums"]["bpm"] == 90
    assert meta["accomp"]["start_sec"] == 2.0
    assert meta["onset_count"] == 3
    assert meta["duration_sec"] == pytest.approx(2.0)

    rows = (out / "onsets.csv").read_text(encoding="utf-8").splitlines()
    assert rows[0] == "time_sec,pitch,gmd_class,velocity"
    assert rows[1].endswith(",36,kick,100")
    assert rows[2].endswith(",38,snare,90")
    assert rows[3].endswith(",42,hihat_closed,80")


def test_build_only는_이름이_맞는_곡만_만든다(
    fake_gmd: Path, fake_musdb_train: Path, tmp_path: Path
):
    song = SongRecipe(name="a", gmd_id="drummer1/session1/2", musdb_song="train/Train Song")
    other = SongRecipe(name="b", gmd_id="drummer1/session1/2", musdb_song="train/Train Song")
    recipe = Recipe("t", fake_gmd, fake_musdb_train, tmp_path / "out", SR, [song, other])
    assert [p.name for p in build_all(recipe, only="b")] == ["b"]
    assert not (tmp_path / "out" / "a").exists()


def test_오디오_없는_GMD_연주는_거부한다(fake_gmd: Path, fake_musdb_train: Path, tmp_path: Path):
    song = SongRecipe(name="x", gmd_id="drummer2/session1/1", musdb_song="train/Train Song")
    recipe = Recipe("t", fake_gmd, fake_musdb_train, tmp_path / "out", SR, [song])
    with pytest.raises(ValueError):
        build_all(recipe)


def test_recipe_yaml을_읽는다(tmp_path: Path):
    path = tmp_path / "r.yaml"
    path.write_text(
        "version: v\ngmd_root: g\nmusdb_root: m\noutput_root: o\n"
        "songs:\n  - name: s\n    gmd_id: d/s/1\n    musdb_song: train/x\n    duration_sec: 30\n",
        encoding="utf-8",
    )
    recipe = Recipe.from_yaml(path)
    assert recipe.sample_rate == SR
    assert recipe.songs[0].duration_sec == 30.0
    assert recipe.songs[0].accomp_gain_db == 0.0
