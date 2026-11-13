"""드럼 분리 입력 채보 모델 비교표 스크립트 테스트."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.pads import HITS_DTYPE
from ssaplash_ai.bench.transcribers.transcriber_base import hits_to_midi

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "score_sep_compare.py"


def _load():
    spec = importlib.util.spec_from_file_location("score_sep_compare", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _hits(rows):
    return np.array([(t, p, 100) for t, p in rows], dtype=HITS_DTYPE)


def test_예측_MIDI를_9패드_타격_표로_다시_읽는다(tmp_path: Path):
    m = _load()
    hits = _hits([(0.1, "KICK"), (0.2, "HIHAT_PEDAL"), (0.3, "MID_TOM"), (0.4, "RIDE")])
    back = m.read_midi_hits(hits_to_midi(hits, tmp_path / "a.mid"))
    assert back["pad"].tolist() == ["KICK", "HIHAT_PEDAL", "MID_TOM", "RIDE"]
    np.testing.assert_allclose(back["time_sec"], hits["time_sec"], atol=2e-3)


def test_조합은_탐만_현재_모델에서_나머지는_실제_녹음_학습_모델에서_가져온다():
    m = _load()
    current = _hits([(0.1, "KICK"), (0.2, "FLOOR_TOM")])
    realrec = _hits([(0.1, "KICK"), (0.15, "HIHAT_PEDAL"), (0.2, "MID_TOM")])
    out = m.combine(current, realrec)
    assert list(zip(out["time_sec"].round(2).tolist(), out["pad"].tolist(), strict=True)) == [
        (0.1, "KICK"),
        (0.15, "HIHAT_PEDAL"),
        (0.2, "FLOOR_TOM"),
    ]


def test_정답도_예측도_없는_패드는_점수_대신_빈칸으로_적는다():
    m = _load()
    assert m.cell([0, 0, 0]) == "—"
    assert m.cell([1, 1, 0]) == "0.667"


def test_run_폴더의_곡별_MIDI_경로를_곡_이름으로_찾는다(tmp_path: Path):
    m = _load()
    hits = _hits([(0.1, "SNARE")])
    hits_to_midi(hits, tmp_path / "run" / "midi" / "model_a" / "drummer_1" / "song_x.mid")
    assert list(m.song_midis(tmp_path / "run")) == ["drummer_1/song_x"]


def test_심벌_7클래스_조합은_크래시·라이드만_바꾼다():
    m = _load()
    base = _hits([(0.1, "KICK"), (0.2, "CRASH"), (0.3, "MID_TOM")])
    cym = _hits([(0.1, "KICK"), (0.2, "RIDE"), (0.4, "CRASH")])
    out = m.replace_cymbals(base, cym)
    assert list(zip(out["time_sec"].round(2).tolist(), out["pad"].tolist(), strict=True)) == [
        (0.1, "KICK"),
        (0.2, "RIDE"),
        (0.3, "MID_TOM"),
        (0.4, "CRASH"),
    ]
