"""노래 파일 채보 하이햇 페달 방법 비교 스크립트 테스트."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.pads import HITS_DTYPE

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def _load():
    # score_sep_compare를 import하므로 scripts 폴더를 경로에 넣음
    sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location(
        "score_pedal_relabel", SCRIPTS / "score_pedal_relabel.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _hits(rows):
    return np.array([(t, p, 100) for t, p in rows], dtype=HITS_DTYPE)


CURRENT = _hits([(0.10, "KICK"), (0.50, "HIHAT"), (1.00, "HIHAT"), (1.50, "HIHAT")])
# 0.51 페달만, 1.01 페달과 하이햇 둘 다, 2.00 현재 모델에 없는 페달
REALREC = _hits(
    [(0.51, "HIHAT_PEDAL"), (1.01, "HIHAT_PEDAL"), (1.01, "HIHAT"), (2.00, "HIHAT_PEDAL")]
)


def test_이름_바꾸기는_가까운_페달_예측이_있는_HIHAT만_바꾼다():
    m = _load()
    out, n = m.relabel(CURRENT, REALREC, 0.03, check_hihat=False)
    assert n == 2
    assert out["pad"].tolist() == ["KICK", "HIHAT_PEDAL", "HIHAT_PEDAL", "HIHAT"]
    assert out["time_sec"].tolist() == CURRENT["time_sec"].tolist()


def test_하이햇_확인을_켜면_실제_녹음_모델도_하이햇을_낸_자리는_안_바꾼다():
    m = _load()
    out, n = m.relabel(CURRENT, REALREC, 0.03, check_hihat=True)
    assert n == 1
    assert out["pad"].tolist() == ["KICK", "HIHAT_PEDAL", "HIHAT", "HIHAT"]


def test_페달_넣고_하이햇_지우기():
    m = _load()
    out, n = m.add_and_remove(CURRENT, REALREC, 0.05)
    assert n == 2
    assert [(round(float(t), 2), p) for t, p in zip(out["time_sec"], out["pad"], strict=True)] == [
        (0.1, "KICK"),
        (0.51, "HIHAT_PEDAL"),
        (1.01, "HIHAT_PEDAL"),
        (1.5, "HIHAT"),
        (2.0, "HIHAT_PEDAL"),
    ]
