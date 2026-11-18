"""공용 곡(Songsterr) 로더 테스트."""

from __future__ import annotations

import json

import numpy as np
import soundfile as sf

from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset


def _song(root, name: str, sub: str = "final") -> None:
    d = root / name / sub
    d.mkdir(parents=True)
    sr = 44100
    drums = np.zeros((sr, 2), dtype=np.float32)
    drums[100:200] = 0.5
    sf.write(d / "drums.flac", drums, sr)
    sf.write(d / "drumless.flac", np.full((sr, 2), 0.1, dtype=np.float32), sr)
    notes = [
        {"noteId": "n1", "timeMs": 500, "pad": "SNARE", "velocityHint": 95},
        {"noteId": "n2", "timeMs": 0, "pad": "KICK"},
        {"noteId": "n3", "timeMs": 250, "pad": "HIHAT_PEDAL"},
    ]
    chart = {"metrics": {"durationMs": 1000}, "charts": [{"notes": notes}]}
    (d / "chart.json").write_text(json.dumps(chart), encoding="utf-8")


def test_곡_폴더를_찾고_분리_드럼과_채보를_읽는다(tmp_path):
    _song(tmp_path, "b_song")
    _song(tmp_path, "a_song", sub="final_tempomap")
    (tmp_path / "no_final").mkdir()
    cfg = DatasetConfig.from_dict(
        {"name": "t", "kind": "songsterr", "root": str(tmp_path), "sample_rate": 44100}
    )
    ds = load_dataset(cfg)
    assert ds.song_ids() == ["a_song", "b_song"]
    song = ds.load("a_song")
    assert song.drums_true.shape == (2, 44100)
    assert np.allclose(song.mixture, song.drums_true + song.accomp_true, atol=1e-4)
    assert list(song.hits_true["pad"]) == ["KICK", "HIHAT_PEDAL", "SNARE"]
    assert list(song.hits_true["time_sec"]) == [0.0, 0.25, 0.5]
    assert ds.check().ok
