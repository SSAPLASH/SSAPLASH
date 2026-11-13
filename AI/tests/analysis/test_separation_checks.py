"""분리 품질 확인 스크립트 두 개의 계산 함수."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stems = _load("compare_mdb_musdb_stems")


def test_세_입력_비교_스크립트가_불러와진다():
    onset = _load("check_onset_merged")
    assert callable(onset.song_row) and callable(onset.main)


@pytest.mark.parametrize("offset", [0, 137, -64])
def test_상호상관으로_밀린_샘플_수를_찾는다(offset: int):
    rng = np.random.default_rng(0)
    b = rng.standard_normal(4000).astype(np.float32)
    a = stems.shift(b, offset)
    assert stems.find_offset(a, b, 4000) == offset


def test_이득만_다르면_SNR이_아주_크고_이득을_돌려준다():
    rng = np.random.default_rng(1)
    ref = rng.standard_normal(1000)
    snr, gain = stems.gain_fit(0.5 * ref, ref)
    assert gain == pytest.approx(0.5)
    assert snr > 100


def test_MDB_곡_이름을_MUSDB_폴더_키로_바꾼다():
    assert stems.musdb_name("MusicDelta_80sRock") == "80srock"
    assert stems.musdb_name("MusicDelta_Country1") == "country1"


def test_ENST_곡_id를_MUSDB_곡_폴더_이름으로_바꾼다():
    export = _load("export_enst_as_musdb")
    assert export.folder_name("drummer_1/107_minus-one_salsa_sticks") == (
        "drummer_1__107_minus-one_salsa_sticks"
    )
