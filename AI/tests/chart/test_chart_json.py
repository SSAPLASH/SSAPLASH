"""채보 JSON 만들기·검증 테스트 (설계 인수 조건 6·12). BE WorkerResults 검사와 같은 조건을 봄."""

from __future__ import annotations

import copy
from dataclasses import replace

import numpy as np
import pytest

from ssaplash_ai.bench.datasets.pads import HITS_DTYPE
from ssaplash_ai.chart.chart_json import (
    GENERATOR,
    align_origin_to_notes,
    build_chart,
    build_notes,
    grid_origin_ms,
    notes_by_pad,
    tempo_map_timing,
    validate_chart,
)
from ssaplash_ai.chart.errors import ChartOutputError
from ssaplash_ai.chart.tempo import TempoEstimate, TempoMapPoint

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


def test_offsetMs는_다수결_위치가_있으면_그_값():
    # 첫 마디 첫 박(1300ms → 한 마디 당기면 1300)보다 다수결 위치(300ms)를 씀
    tempo = replace(TEMPO, bpm=120.0, first_downbeat_ms=1300, downbeat_phase_ms=300)
    assert grid_origin_ms(tempo) == 300
    failed = replace(tempo, estimated=False)
    assert grid_origin_ms(failed) == 0


def test_offsetMs는_마디_첫_박이_없으면_첫_박():
    assert grid_origin_ms(replace(TEMPO, first_beat_ms=730, first_downbeat_ms=None)) == 730


def test_offsetMs는_bpm_추정_실패나_박이_없으면_0():
    failed = replace(TEMPO, bpm=120.0, estimated=False, first_beat_ms=None, first_downbeat_ms=None)
    assert grid_origin_ms(failed) == 0
    # 박이 모자라 librosa 템포 값만 쓴 경우
    hinted = replace(TEMPO, first_beat_ms=None, first_downbeat_ms=None)
    assert grid_origin_ms(hinted) == 0


# ---- 원점을 킥·스네어 노트에 맞추기 ----

TEMPO_120 = replace(TEMPO, bpm=120.0, first_beat_ms=1880, first_downbeat_ms=1880)


def _beat_notes(origin_ms: float, shift_ms: float, n: int, pad: str = "KICK") -> list[dict]:
    """120bpm 격자 박마다 shift_ms만큼 어긋난 노트 n개 (박 길이 500ms)"""
    return [{"timeMs": int(round(origin_ms + i * 500 + shift_ms)), "pad": pad} for i in range(n)]


def test_원점_보정은_노트가_몰린_만큼_당김():
    notes = _beat_notes(1880, -40, 32)
    assert align_origin_to_notes(1880, TEMPO_120, notes) == 1840
    # 스네어도 씀. 박 사이 8분 위치 노트(250ms)는 창 밖이라 안 셈
    notes = _beat_notes(1880, 20, 16, "SNARE") + _beat_notes(2130, 0, 40)
    assert align_origin_to_notes(1880, TEMPO_120, notes) == 1900


def test_원점_보정은_킥_스네어가_16개보다_적으면_그대로():
    notes = _beat_notes(1880, -40, 15) + _beat_notes(1880, -40, 40, "HIHAT")
    assert align_origin_to_notes(1880, TEMPO_120, notes) == 1880


def test_원점_보정_뒤에도_0ms_이상이고_첫_마디_안():
    # 원점 10ms, 노트 30ms 앞 → −20이라 한 마디(2000ms) 뒤로
    assert align_origin_to_notes(10, TEMPO_120, _beat_notes(10, -30, 32)) == 1980
    # 원점 1990ms, 노트 30ms 뒤 → 2020이라 한 마디 앞으로
    assert align_origin_to_notes(1990, TEMPO_120, _beat_notes(1990, 30, 32)) == 20


def test_원점_보정은_bpm_추정_실패면_그대로():
    failed = replace(TEMPO_120, estimated=False)
    assert align_origin_to_notes(0, failed, _beat_notes(0, 40, 32)) == 0


def test_build_chart_origin_방식():
    rows = [(n["timeMs"] / 1000, "KICK", -1) for n in _beat_notes(1880, -40, 32)]
    hits = _hits(rows)
    downbeat = build_chart(hits, 60_000, TEMPO_120, "v@0123456789ab", 0)
    notes = build_chart(hits, 60_000, TEMPO_120, "v@0123456789ab", 0, origin="notes")
    assert downbeat["charts"][0]["timing"]["offsetMs"] == grid_origin_ms(TEMPO_120) == 1880
    assert notes["charts"][0]["timing"]["offsetMs"] == 1840
    assert notes["charts"][0]["notes"] == downbeat["charts"][0]["notes"]
    validate_chart(notes, 60_000)
    with pytest.raises(ValueError, match="origin"):
        build_chart(hits, 60_000, TEMPO_120, "v@0123456789ab", 0, origin="beat")


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
    with pytest.raises(ChartOutputError, match="패드 9종 밖"):
        build_notes(_hits([(0.1, "tom", -1)]), 3000)


def test_페달_하이햇은_채보_출력_패드():
    notes = build_notes(_hits([(0.1, "HIHAT_PEDAL", -1)]), 3000)
    assert [n["pad"] for n in notes] == ["HIHAT_PEDAL"]
    validate_chart(_chart([(0.1, "HIHAT_PEDAL", -1)]), 3000)


def test_같은_시각_하이햇과_페달은_하이햇이_먼저():
    notes = build_notes(_hits([(0.1, "HIHAT_PEDAL", -1), (0.1, "HIHAT", -1)]), 3000)
    assert [n["pad"] for n in notes] == ["HIHAT", "HIHAT_PEDAL"]


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
        "HIHAT_PEDAL",
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
        ("ppq 0", lambda c: c["charts"][0]["timing"].update(ppq=0)),
        ("tempoMap 빈 목록", lambda c: c["charts"][0]["timing"].update(tempoMap=[])),
        (
            "tempoMap 첫 tick",
            lambda c: c["charts"][0]["timing"].update(tempoMap=[{"tick": 480, "bpm": 120.0}]),
        ),
        (
            "tempoMap 첫 bpm 다름",
            lambda c: c["charts"][0]["timing"].update(tempoMap=[{"tick": 0, "bpm": 99.0}]),
        ),
        (
            "tempoMap tick 역순",
            lambda c: c["charts"][0]["timing"].update(
                tempoMap=[
                    {"tick": 0, "bpm": c["charts"][0]["timing"]["bpm"]},
                    {"tick": 0, "bpm": 100.0},
                ]
            ),
        ),
        (
            "tempoMap bpm 0",
            lambda c: c["charts"][0]["timing"].update(
                tempoMap=[
                    {"tick": 0, "bpm": c["charts"][0]["timing"]["bpm"]},
                    {"tick": 960, "bpm": 0},
                ]
            ),
        ),
        (
            "timeSignatureMap 다름",
            lambda c: c["charts"][0]["timing"].update(
                timeSignatureMap=[{"tick": 0, "numerator": 3, "denominator": 4}]
            ),
        ),
        (
            "timeSignatureMap 음표 3",
            lambda c: c["charts"][0]["timing"].update(
                timeSignatureMap=[{"tick": 0, "numerator": 4, "denominator": 3}]
            ),
        ),
    ],
)
def test_BE가_거절하는_값은_출력_오류(label: str, mutate):
    with pytest.raises(ChartOutputError, match="채보 JSON 검증 실패"):
        validate_chart(_broken(mutate), 3000)


def test_빠르기_변화_목록이_있어도_통과():
    chart = _broken(lambda c: None)
    timing = chart["charts"][0]["timing"]
    timing.update(
        ppq=480,
        tempoMap=[{"tick": 0, "bpm": timing["bpm"]}, {"tick": 57600, "bpm": 105.0}],
        timeSignatureMap=[{"tick": 0, "numerator": 4, "denominator": 4}],
    )
    validate_chart(chart, 3000)


# ---- 빠르기 구간 ----

# 120bpm 마디 첫 박 4500ms에서 시작, 16박 뒤(12500ms) 100bpm
TEMPO_MAP = replace(
    TEMPO,
    bpm=110.0,
    tempo_map=[
        TempoMapPoint(time_ms=4500.0, beat=0, bpm=120.0),
        TempoMapPoint(time_ms=12500.0, beat=16, bpm=100.0),
    ],
)


def test_빠르기_구간이_있으면_tempoMap을_냄():
    chart = build_chart(_hits([(5.0, "KICK", -1)]), 60_000, TEMPO_MAP, "v@0123456789ab", 0)
    timing = chart["charts"][0]["timing"]
    # 첫 구간 시작 4500ms에서 한 마디(2000ms)씩 두 번 당긴 500ms가 틱 0. 두 번째 구간은 (16 + 8)박
    assert timing == {
        "bpm": 120.0,
        "offsetMs": 500,
        "timeSignature": "4/4",
        "ppq": 480,
        "tempoMap": [{"tick": 0, "bpm": 120.0}, {"tick": 24 * 480, "bpm": 100.0}],
        "timeSignatureMap": [{"tick": 0, "numerator": 4, "denominator": 4}],
    }
    validate_chart(chart, 60_000)


def test_빠르기_구간도_킥_스네어_노트로_옮김():
    # 모든 박에서 20ms 일찍 친 킥 32개 (앞 16박은 500ms 간격, 뒤 16박은 600ms 간격)
    times = [4500 + i * 500 - 20 for i in range(16)] + [12500 + i * 600 - 20 for i in range(16)]
    notes = [{"timeMs": t, "pad": "KICK"} for t in times]
    timing = tempo_map_timing(TEMPO_MAP, notes, "notes")
    assert timing["offsetMs"] == 480
    assert tempo_map_timing(TEMPO_MAP, notes, "downbeat")["offsetMs"] == 500


def test_빠르기_구간이_하나면_고정_bpm():
    one = replace(TEMPO_MAP, tempo_map=[TempoMapPoint(time_ms=4500.0, beat=0, bpm=120.0)])
    assert tempo_map_timing(one, [], "notes") is None
    chart = build_chart(_hits([(5.0, "KICK", -1)]), 60_000, one, "v@0123456789ab", 0)
    assert "tempoMap" not in chart["charts"][0]["timing"]
