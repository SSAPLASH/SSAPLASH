"""채보 노트로 bpm·첫 박 다시 맞추기 테스트."""

from __future__ import annotations

import numpy as np
import pytest

from ssaplash_ai.chart.chart_json import refine_chart_timing
from ssaplash_ai.chart.config import TempoConfig
from ssaplash_ai.chart.tempo import TempoEstimate
from ssaplash_ai.chart.tempo_refine import (
    MIN_NOTES,
    metronome_drift,
    off_grid_ratio,
    refine_timing,
)


def _grid(bpm: float, offset: float, n: int, div: int = 4) -> np.ndarray:
    """bpm·첫 박 기준 한 박 div칸에 놓인 노트 시각(ms)."""
    return np.round(offset + np.arange(n) * 60000 / bpm / div)


def test_소수점만큼_틀린_bpm은_정수로_바꾸고_첫_박도_맞춤():
    # 실제 곡은 87bpm인데 박 추적이 86.94로 잡아 곡 끝으로 갈수록 밀리는 경우(NCS On & On)
    t = _grid(87.0, 140, 800)
    r = refine_timing(t, 86.94, 138)
    assert r.changed and r.bpm == 87.0
    assert abs(r.offset_ms - 140) <= 2
    assert r.before_off_grid > 0.3 and r.after_off_grid == 0
    assert r.reason == "박자 칸 벗어남 줄어듦"


def test_벗어남은_적어도_메트로놈이_밀리면_바꿈():
    # 165.02로 잡힌 165bpm 곡(NCS Phoenix). 끝까지 15ms 안이라 벗어난 노트는 없지만 곡 끝으로 갈수록 밀림
    t = _grid(165.0, 1163, 1000)
    r = refine_timing(t, 165.02, 1163)
    assert r.before_off_grid == 0
    assert r.changed and r.bpm == 165.0
    assert abs(r.before_drift_ms) > 8 and abs(r.after_drift_ms) <= 2
    assert r.reason == "메트로놈 밀림 줄어듦"


def test_정수가_아닌_실제_bpm은_그대로():
    t = _grid(158.5, 50, 800)
    r = refine_timing(t, 158.5, 50)
    assert not r.changed and r.bpm == 158.5 and r.offset_ms == 50


def test_정수가_안_맞으면_0_01_간격으로_찾음():
    # 167.17bpm 곡을 167.19로 잡은 경우(NCS Earth). 정수 167은 비율이 나빠져 0.01 간격 후보를 씀
    t = _grid(167.17, 34, 1500)
    r = refine_timing(t, 167.19, 43)
    assert r.changed and r.bpm == pytest.approx(167.17)
    assert abs(r.after_drift_ms) < abs(r.before_drift_ms)


def test_셋잇단_곡은_셋잇단_칸으로_맞춤():
    t = _grid(80.0, 650, 600, div=6)
    r = refine_timing(t, 79.0, 627)
    assert r.changed and r.bpm == 80.0 and r.grid_div == 6


def test_노트가_적거나_범위_밖이면_안_바꿈():
    t = _grid(87.0, 140, MIN_NOTES - 1)
    assert not refine_timing(t, 86.94, 138).changed
    # 바뀔 bpm이 설정 범위 밖이면 그대로
    t = _grid(201.0, 0, 800)
    assert not refine_timing(t, 200.96, 0, max_bpm=200).changed


def test_측정_함수():
    t = _grid(120.0, 0, 400)
    assert off_grid_ratio(t, 120.0, 0) == 0
    assert abs(metronome_drift(t, 120.0, 0)) < 1
    # 120.05로 보면 메트로놈 칸이 짧아 곡 끝으로 갈수록 노트가 메트로놈보다 늦음(+)
    assert metronome_drift(t, 120.05, 0) > 5


def _chart(t: np.ndarray, bpm: float, offset: int) -> dict:
    notes = [{"noteId": f"n{i + 1:04d}", "timeMs": int(x), "pad": "HIHAT"} for i, x in enumerate(t)]
    return {
        "charts": [
            {"notes": notes, "timing": {"bpm": bpm, "offsetMs": offset, "timeSignature": "4/4"}}
        ]
    }


def _tempo(estimated: bool) -> TempoEstimate:
    return TempoEstimate(
        bpm=86.94,
        raw_bpm=86.94,
        first_beat_ms=138,
        first_downbeat_ms=138,
        n_beats=200,
        time_signature="4/4",
        estimated=estimated,
        method="beat_this",
    )


def test_채보_JSON_timing만_바꾸고_노트는_그대로():
    t = _grid(87.0, 140, 800)
    chart = _chart(t, 86.94, 138)
    before = [n["timeMs"] for n in chart["charts"][0]["notes"]]
    r = refine_chart_timing(chart, _tempo(True), 60, 200)
    assert r is not None and r.changed
    assert chart["charts"][0]["timing"]["bpm"] == 87.0
    assert [n["timeMs"] for n in chart["charts"][0]["notes"]] == before


def test_bpm_추정_실패면_안_건드림():
    chart = _chart(_grid(87.0, 140, 800), 120.0, 0)
    assert refine_chart_timing(chart, _tempo(False), 60, 200) is None
    assert chart["charts"][0]["timing"]["bpm"] == 120.0


def test_설정_refine():
    assert TempoConfig.from_dict({}).refine is False
    assert TempoConfig.from_dict({"refine": True}).refine is True
    with pytest.raises(ValueError, match="refine"):
        TempoConfig.from_dict({"refine": "yes"})


def test_빠르기_구간이_있으면_안_건드림():
    chart = _chart(_grid(87.0, 140, 800), 86.94, 138)
    chart["charts"][0]["timing"].update(ppq=480, tempoMap=[{"tick": 0, "bpm": 86.94}])
    assert refine_chart_timing(chart, _tempo(True), 60, 200) is None
    assert chart["charts"][0]["timing"]["bpm"] == 86.94
