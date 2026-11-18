"""채보 후처리 후보 함수 테스트."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.pads import HITS_DTYPE

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _act(n: int = 200) -> np.ndarray:
    """킥(0열) 0.5초에 0.9, 스네어(1열) 0.5초에 0.15·1.2초에 0.15. 나머지 0."""
    a = np.zeros((n, 5), dtype=np.float32)
    a[50, 0] = 0.9
    a[50, 1] = 0.15
    a[120, 1] = 0.15
    return a


def test_후보를_모두_끄면_피크를_그대로_돌려준다():
    pp = _load("postproc_eval")
    peaks = {35: [0.5], 38: [], 47: [], 42: [], 49: []}
    assert pp.repick(_act(), peaks, {"name": "current"}) is peaks


def test_문턱값_배수는_킥_스네어_하이햇에만_m_심벌에_c_탐은_그대로():
    pp = _load("postproc_eval")
    thr = pp.thresholds({"thr_m": 0.5, "thr_c": 0.7})
    assert thr[35] == 0.11 and thr[38] == 0.12 and thr[42] == 0.11
    assert abs(thr[49] - 0.21) < 1e-9 and thr[47] == 0.32
    peaks = pp.repick(_act(), {47: [9.9]}, {"thr_m": 0.5})
    assert peaks[38] == [0.5, 1.2] and peaks[47] == [9.9]  # 스네어 0.15 ≥ 0.12


def test_동시_타격_보충은_다른_피크_근처에서만_문턱값을_낮춘다():
    pp = _load("postproc_eval")
    peaks = pp.repick(_act(), {47: []}, {"co_r": 0.5})
    # 기본 스네어 문턱값 0.24에는 안 걸리고, 0.12로 낮추면 0.5초(킥과 같은 자리)만 더함
    assert peaks[35] == [0.5] and peaks[38] == [0.5]


def test_탐을_스네어로_바꾸기는_스네어_점수가_충분하고_근처에_스네어가_없을_때만():
    pp = _load("postproc_eval")
    act = np.zeros((300, 5), dtype=np.float32)
    act[50, 1], act[50, 2] = 0.6, 0.8  # 0.5초: 스네어 0.6, 탐 0.8
    act[150, 1], act[150, 2] = 0.1, 0.8  # 1.5초: 스네어 0.1
    act[250, 2] = 0.8  # 2.5초: 스네어 타격이 바로 옆에 있음
    hits = np.array(
        [
            (0.5, "FLOOR_TOM", 0),
            (1.5, "MID_TOM", 0),
            (2.5, "FLOOR_TOM", 0),
            (2.51, "SNARE", 0),
            (0.5, "KICK", 0),
        ],
        dtype=HITS_DTYPE,
    )
    out = pp.relabel(hits, act, {"tom2sn": 0.7})
    assert list(out["pad"]) == ["SNARE", "MID_TOM", "FLOOR_TOM", "SNARE", "KICK"]
    assert list(pp.relabel(hits, act, {"name": "current"})["pad"]) == list(hits["pad"])


def test_고르기는_MDB가_오르고_E_GMD가_크게_안_떨어진_후보만():
    pp = _load("postproc_eval")
    cands = [{"name": "current"}, {"name": "a", "co_r": 0.5}, {"name": "b", "co_r": 0.7},
             {"name": "c", "tom2sn": 0.5}, {"name": "d", "hh2sn": 0.5}]  # fmt: skip
    mdb = {"current": 0.80, "a": 0.82, "b": 0.81, "c": 0.805, "d": 0.79}
    egmd = {"current": 0.60, "a": 0.59, "b": 0.60, "c": 0.60, "d": 0.70}
    picked = pp.choose(mdb, egmd, cands)
    assert picked["co"]["name"] == "b"  # a는 E-GMD가 0.01 떨어져 빠짐
    assert picked["tom2sn"]["name"] == "c" and "hh2sn" not in picked
    combos = pp.combos(picked, mdb)
    assert combos == [{"name": "combo_b+c", "co_r": 0.7, "tom2sn": 0.5}]
