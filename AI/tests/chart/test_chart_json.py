"""채보 JSON 만들기·검증 테스트 (설계 인수 조건 6·12). BE WorkerResults 검사와 같은 조건을 봄."""

from __future__ import annotations

import copy
from dataclasses import replace

import numpy as np
import pytest

from ssaplash_ai.bench.datasets.pads import HITS_DTYPE
from ssaplash_ai.chart.chart_json import (
    GENERATOR,
    build_chart,
    build_notes,
    grid_origin_ms,
    notes_by_pad,
    validate_chart,
)
from ssaplash_ai.chart.errors import ChartOutputError
from ssaplash_ai.chart.tempo import TempoEstimate

TEMPO = TempoEstimate(
    bpm=118.5,
    raw_bpm=117.45,
    first_beat_ms=500,
    first_downbeat_ms=500,
    n_beats=20,
    time_signature="4/4",
    estimated=True,
    method="beat_this",
)


def _hits(rows: list[tuple[float, str, int]]) -> np.ndarray:
    return np.array(rows, dtype=HITS_DTYPE)


def _chart(rows: list[tuple[float, str, int]], duration_ms: int = 3000) -> dict:
    return build_chart(_hits(rows), duration_ms, TEMPO, "adtof_drumsep@0123456789ab", 1234)


def test_모양이_BE_예시와_같음():
    chart = _chart([(0.1, "SNARE", -1)])
    assert chart["schemaVersion"] == 1
    assert chart["generator"] == GENERATOR == "ADT_MODEL"
    assert chart["generatorVersion"] == "adtof_drumsep@0123456789ab"
    assert chart["metrics"] == {"transcribeMs": 1234, "durationMs": 3000}
    (c,) = chart["charts"]
    assert c["difficulty"] == "NORMAL" and c["notationStatus"] == "UNAVAILABLE"
    assert "sheetPages" not in c
    assert c["timing"] == {"bpm": 118.5, "offsetMs": 500, "timeSignature": "4/4"}
    assert c["notes"] == [{"noteId": "n0001", "timeMs": 100, "pad": "SNARE"}]
    validate_chart(chart, 3000)


@pytest.mark.parametrize(
    ("bpm", "downbeat_ms", "expected"),
    [
        (120.0, 240, 240),  # 첫 마디 첫 박이 곡 맨 앞 한 마디 길이 안이면 그대로
        (120.0, 30_000, 0),  # 드럼이 30초에 들어옴 → 한 마디 2초씩 당겨 0
        (84.0, 6_430, 716),  # 한 마디 2857.14ms씩 두 번 당김
    ],
)
def test_offsetMs는_마디_첫_박을_한_마디씩_당긴_가장_이른_마디(
    bpm: float, downbeat_ms: int, expected: int
):
    tempo = replace(TEMPO, bpm=bpm, first_beat_ms=downbeat_ms - 200, first_downbeat_ms=downbeat_ms)
    assert grid_origin_ms(tempo) == expected
    chart = build_chart(_hits([(0.1, "KICK", -1)]), 60_000, tempo, "v@0123456789ab", 0)
    assert chart["charts"][0]["timing"]["offsetMs"] == expected
    validate_chart(chart, 60_000)


def test_offsetMs는_마디_첫_박이_없으면_첫_박():
    assert grid_origin_ms(replace(TEMPO, first_beat_ms=730, first_downbeat_ms=None)) == 730


def test_offsetMs는_bpm_추정_실패나_박이_없으면_0():
    failed = replace(TEMPO, bpm=120.0, estimated=False, first_beat_ms=None, first_downbeat_ms=None)
    assert grid_origin_ms(failed) == 0
    # 박이 모자라 librosa 템포 값만 쓴 경우
    hinted = replace(TEMPO, first_beat_ms=None, first_downbeat_ms=None)
    assert grid_origin_ms(hinted) == 0


def test_시각순_정렬_같은_시각은_패드_순서():
    notes = build_notes(
        _hits([(0.5, "CRASH", -1), (0.5, "KICK", -1), (0.2, "HIHAT", -1), (0.5, "SNARE", -1)]),
        3000,
    )
    assert [(n["timeMs"], n["pad"]) for n in notes] == [
        (200, "HIHAT"),
        (500, "KICK"),
        (500, "SNARE"),
        (500, "CRASH"),
    ]
    assert [n["noteId"] for n in notes] == ["n0001", "n0002", "n0003", "n0004"]


def test_같은_시각_같은_패드는_하나만_세기는_큰_쪽():
    notes = build_notes(_hits([(0.5, "KICK", 40), (0.5004, "KICK", 90), (0.6, "KICK", -1)]), 3000)
    assert notes == [
        {"noteId": "n0001", "timeMs": 500, "pad": "KICK", "velocityHint": 90},
        {"noteId": "n0002", "timeMs": 600, "pad": "KICK"},
    ]


def test_시각은_0과_길이_사이로_자름():
    notes = build_notes(_hits([(-0.01, "KICK", -1), (3.0006, "SNARE", -1)]), 3000)
    assert [n["timeMs"] for n in notes] == [0, 3000]


def test_거친_라벨은_출력_오류():
    with pytest.raises(ChartOutputError, match="패드 8종 밖"):
        build_notes(_hits([(0.1, "tom", -1)]), 3000)


def test_페달_하이햇은_채보_출력에서_오류():
    # 정답·채점에는 HIHAT_PEDAL이 있지만 BE가 받는 패드는 8종
    with pytest.raises(ChartOutputError, match="패드 8종 밖"):
        build_notes(_hits([(0.1, "HIHAT_PEDAL", -1)]), 3000)


def test_노트가_없어도_통과():
    chart = _chart([])
    assert chart["charts"][0]["notes"] == []
    validate_chart(chart, 3000)


def test_패드별_개수():
    counts = notes_by_pad(_chart([(0.1, "KICK", -1), (0.2, "KICK", -1), (0.3, "RIDE", -1)]))
    assert counts["KICK"] == 2 and counts["RIDE"] == 1 and counts["SMALL_TOM"] == 0
    assert list(counts) == [
        "KICK",
        "SNARE",
        "HIHAT",
        "SMALL_TOM",
        "MID_TOM",
        "FLOOR_TOM",
        "CRASH",
        "RIDE",
    ]


def _broken(mutate) -> dict:
    chart = copy.deepcopy(_chart([(0.1, "KICK", -1), (0.2, "SNARE", 100)]))
    mutate(chart)
    return chart


@pytest.mark.parametrize(
    ("label", "mutate"),
    [
        ("generator", lambda c: c.update(generator="adtof_drumsep")),
        ("generatorVersion 51자", lambda c: c.update(generatorVersion="x" * 51)),
        ("generatorVersion 빈 값", lambda c: c.update(generatorVersion=" ")),
        ("schemaVersion", lambda c: c.update(schemaVersion=2)),
        ("charts 2개", lambda c: c["charts"].append(c["charts"][0])),
        ("difficulty", lambda c: c["charts"][0].update(difficulty="HARD")),
        ("notationStatus", lambda c: c["charts"][0].update(notationStatus="READY")),
        ("sheetPages", lambda c: c["charts"][0].update(sheetPages=[])),
        ("noteId 중복", lambda c: c["charts"][0]["notes"][1].update(noteId="n0001")),
        ("noteId 65자", lambda c: c["charts"][0]["notes"][0].update(noteId="n" * 65)),
        ("timeMs 역순", lambda c: c["charts"][0]["notes"][1].update(timeMs=50)),
        ("timeMs 길이 초과", lambda c: c["charts"][0]["notes"][1].update(timeMs=3001)),
        ("timeMs 실수", lambda c: c["charts"][0]["notes"][1].update(timeMs=200.5)),
        ("pad", lambda c: c["charts"][0]["notes"][0].update(pad="HI_TOM")),
        ("velocityHint", lambda c: c["charts"][0]["notes"][1].update(velocityHint=128)),
        ("bpm 0", lambda c: c["charts"][0]["timing"].update(bpm=0)),
        ("bpm nan", lambda c: c["charts"][0]["timing"].update(bpm=float("nan"))),
        ("bpm 상한", lambda c: c["charts"][0]["timing"].update(bpm=10000)),
        ("offsetMs 실수", lambda c: c["charts"][0]["timing"].update(offsetMs=0.5)),
        ("timeSignature 6자", lambda c: c["charts"][0]["timing"].update(timeSignature="12/16x")),
    ],
)
def test_BE가_거절하는_값은_출력_오류(label: str, mutate):
    with pytest.raises(ChartOutputError, match="채보 JSON 검증 실패"):
        validate_chart(_broken(mutate), 3000)
