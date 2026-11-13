"""타격 표 → 채보 JSON (BE TranscriptionResult schemaVersion 1).

- generator는 BE가 `ADT_MODEL`만 받아서 고정. 모델·규칙은 generatorVersion에 남김
- charts는 NORMAL 하나, notationStatus는 UNAVAILABLE
- notes: 시각순 `n0001`부터. timeMs는 반올림 정수, 0~durationMs. 같은 시각은 패드 9종 순서,
  같은 시각·같은 패드는 하나만 남김
- timing: offsetMs는 곡의 첫 마디 첫 박 시각. 빠르기 구간이 둘 이상이면 ppq·tempoMap·timeSignatureMap을 더 넣음

validate_chart는 BE `WorkerResults.java`의 검사를 그대로 옮긴 것. 실패하면 ChartOutputError.
"""

from __future__ import annotations

import math

import numpy as np

from ssaplash_ai.bench.datasets.pads import PADS
from ssaplash_ai.chart.config import ORIGIN_MODES
from ssaplash_ai.chart.errors import ChartOutputError
from ssaplash_ai.chart.tempo import TempoEstimate, TempoMapPoint
from ssaplash_ai.chart.tempo_refine import RefineResult, refine_timing

GENERATOR = "ADT_MODEL"
DIFFICULTY = "NORMAL"
NOTATION_STATUS = "UNAVAILABLE"
GENERATOR_VERSION_MAX = 50
NOTE_ID_MAX = 64
MAX_NOTES = 50000
BPM_MIN = 0.01
BPM_MAX = 9999.99
TIME_SIGNATURE_MAX = 5
NOTE_ID_WIDTH = 4
# offsetMs·bpm 계산 규칙 버전. 규칙이 바뀌면 올려서 generatorVersion이 바뀌게 함(transcription.model_version)
TIMING_RULES_VERSION = "timing5"
# 빠르기 구간(tempoMap) 틱 단위. BE MIDI 채보와 같은 480
TEMPO_MAP_PPQ = 480
# 원점 보정에 쓰는 노트. 8분·16분에 많은 하이햇·심벌은 빼고 4분 박에 주로 오는 패드만
ORIGIN_ALIGN_PADS = ("KICK", "SNARE")
# 격자 박에서 이 거리 안의 노트만 보정에 씀
ORIGIN_ALIGN_WINDOW_MS = 60.0
# 쓸 노트가 이보다 적으면 보정하지 않음
ORIGIN_ALIGN_MIN_NOTES = 16

# BE 결과 검증이 받는 패드 9종(HIHAT_PEDAL 포함). 같은 시각 노트는 이 순서로 정렬
_PAD_ORDER = {pad: i for i, pad in enumerate(PADS)}


def build_notes(hits: np.ndarray, duration_ms: int) -> list[dict]:
    """타격 표(HITS_DTYPE) → notes 목록. 패드 9종 밖의 값(거친 라벨 tom·cymbal)이 있으면 ChartOutputError."""
    rows: set[tuple[int, str, int]] = set()
    for row in hits:
        pad = str(row["pad"])
        if pad not in _PAD_ORDER:
            raise ChartOutputError(
                f"패드 9종 밖의 값이 나옴: {pad} (채보 모델이 9패드 안에서 내야 함)"
            )
        time_ms = min(max(int(round(float(row["time_sec"]) * 1000)), 0), duration_ms)
        rows.add((time_ms, pad, int(row["velocity"])))
    # 같은 시각·같은 패드는 세기가 큰 것 하나만
    best: dict[tuple[int, str], int] = {}
    for time_ms, pad, velocity in rows:
        key = (time_ms, pad)
        best[key] = max(best.get(key, velocity), velocity)
    ordered = sorted(best.items(), key=lambda kv: (kv[0][0], _PAD_ORDER[kv[0][1]]))
    notes: list[dict] = []
    for i, ((time_ms, pad), velocity) in enumerate(ordered, start=1):
        note: dict = {"noteId": f"n{i:0{NOTE_ID_WIDTH}d}", "timeMs": time_ms, "pad": pad}
        if velocity > 0:
            note["velocityHint"] = min(int(velocity), 127)
        notes.append(note)
    return notes


def grid_origin_ms(tempo: TempoEstimate) -> int:
    """채보 JSON offsetMs(곡의 첫 마디 첫 박). FE 악보 격자와 BE 난이도 솎기의 원점.

    마디 첫 박 다수결 위치 → 첫 마디 첫 박을 한 마디씩 당긴 위치 → 첫 박 시각 순으로 있는 것을 씀. 추정 실패면 0.
    """
    if not tempo.estimated:
        return 0
    if tempo.downbeat_phase_ms is not None:
        return tempo.downbeat_phase_ms
    if tempo.first_downbeat_ms is not None:
        beats_per_bar = int(tempo.time_signature.split("/")[0])
        bar_ms = 60_000.0 / tempo.bpm * beats_per_bar
        return int(round(tempo.first_downbeat_ms % bar_ms))
    if tempo.first_beat_ms is not None:
        return tempo.first_beat_ms
    return 0


def align_origin_to_notes(origin_ms: int, tempo: TempoEstimate, notes: list[dict]) -> int:
    """원점을 킥·스네어 노트로 박 안 위치만 보정.

    가장 가까운 박과의 차이가 ORIGIN_ALIGN_WINDOW_MS 안인 노트의 중앙값만큼 옮김.
    쓸 노트가 ORIGIN_ALIGN_MIN_NOTES보다 적거나 bpm 추정 실패면 그대로.
    """
    if not tempo.estimated:
        return origin_ms
    beat_ms = 60_000.0 / tempo.bpm
    bar_ms = beat_ms * int(tempo.time_signature.split("/")[0])
    times = np.array([n["timeMs"] for n in notes if n["pad"] in ORIGIN_ALIGN_PADS], dtype=float)
    d = (times - origin_ms + beat_ms / 2) % beat_ms - beat_ms / 2
    d = d[np.abs(d) <= ORIGIN_ALIGN_WINDOW_MS]
    if len(d) < ORIGIN_ALIGN_MIN_NOTES:
        return origin_ms
    aligned = origin_ms + int(round(float(np.median(d))))
    if aligned < 0:
        aligned += bar_ms
    elif origin_ms < bar_ms <= aligned:
        aligned -= bar_ms
    return int(round(aligned))


def _beat_number(points: list[TempoMapPoint], time_ms: np.ndarray) -> np.ndarray:
    """곡 시각 → 박 번호(실수). 첫 구간 앞은 첫 구간 빠르기로 거꾸로 셈"""
    starts = np.array([p.time_ms for p in points])
    i = np.clip(np.searchsorted(starts, time_ms, side="right") - 1, 0, len(points) - 1)
    beat = np.array([p.beat for p in points], dtype=float)[i]
    bpm = np.array([p.bpm for p in points])[i]
    return beat + (time_ms - starts[i]) * bpm / 60_000.0


def tempo_map_timing(tempo: TempoEstimate, notes: list[dict], origin: str) -> dict | None:
    """빠르기 구간이 있는 채보 JSON timing. 구간이 둘 미만이면 None.

    offsetMs(틱 0)는 첫 구간 시작에서 한 마디씩 당겨 0ms 이상인 가장 이른 마디 시작.
    tempoMap 첫 항목은 틱 0·첫 구간 bpm, 나머지는 구간 시작 박 번호 × TEMPO_MAP_PPQ.
    origin이 notes면 align_origin_to_notes와 같은 방식으로 모든 구간 시작을 옮김.
    """
    points = tempo.tempo_map
    if not tempo.estimated or not points or len(points) < 2:
        return None
    shift = 0.0
    if origin == "notes":
        times = np.array([n["timeMs"] for n in notes if n["pad"] in ORIGIN_ALIGN_PADS], dtype=float)
        if times.size:
            beat = _beat_number(points, times)
            nearest = np.round(beat)
            bpm = np.array([p.bpm for p in points])[
                np.clip(
                    np.searchsorted([p.time_ms for p in points], times, side="right") - 1,
                    0,
                    len(points) - 1,
                )
            ]
            d = (beat - nearest) * 60_000.0 / bpm
            d = d[np.abs(d) <= ORIGIN_ALIGN_WINDOW_MS]
            if d.size >= ORIGIN_ALIGN_MIN_NOTES:
                shift = float(np.median(d))
    beats_per_bar = int(tempo.time_signature.split("/")[0])
    first = points[0]
    bar0 = 60_000.0 / first.bpm * beats_per_bar
    start0 = first.time_ms + shift
    pulled = math.floor(start0 / bar0)
    offset = int(round(start0 - pulled * bar0))
    base = pulled * beats_per_bar
    tempo_map = [{"tick": 0, "bpm": first.bpm}]
    tempo_map += [{"tick": (p.beat + base) * TEMPO_MAP_PPQ, "bpm": p.bpm} for p in points[1:]]
    numerator, denominator = (int(x) for x in tempo.time_signature.split("/"))
    return {
        "bpm": first.bpm,
        "offsetMs": offset,
        "timeSignature": tempo.time_signature,
        "ppq": TEMPO_MAP_PPQ,
        "tempoMap": tempo_map,
        "timeSignatureMap": [{"tick": 0, "numerator": numerator, "denominator": denominator}],
    }


def build_chart(
    hits: np.ndarray,
    duration_ms: int,
    tempo: TempoEstimate,
    generator_version: str,
    transcribe_ms: int,
    schema_version: int = 1,
    origin: str = "downbeat",
) -> dict:
    """채보 JSON dict. 검증은 validate_chart를 따로 부름. origin은 ORIGIN_MODES 중 하나."""
    if origin not in ORIGIN_MODES:
        raise ValueError(f"origin은 {ORIGIN_MODES} 중 하나: {origin!r}")
    notes = build_notes(hits, duration_ms)
    timing = tempo_map_timing(tempo, notes, origin)
    if timing is None:
        offset_ms = grid_origin_ms(tempo)
        if origin == "notes":
            offset_ms = align_origin_to_notes(offset_ms, tempo, notes)
        timing = {"bpm": tempo.bpm, "offsetMs": offset_ms, "timeSignature": tempo.time_signature}
    return {
        "schemaVersion": schema_version,
        "generator": GENERATOR,
        "generatorVersion": generator_version,
        "metrics": {"transcribeMs": int(transcribe_ms), "durationMs": int(duration_ms)},
        "charts": [
            {
                "difficulty": DIFFICULTY,
                "notationStatus": NOTATION_STATUS,
                "notes": notes,
                "timing": timing,
            }
        ],
    }


def refine_chart_timing(
    chart: dict, tempo: TempoEstimate, min_bpm: float, max_bpm: float
) -> RefineResult | None:
    """채보 노트로 chart의 bpm·offsetMs를 다시 맞춤. 추정 실패이거나 tempoMap이 있으면 None."""
    timing = chart["charts"][0]["timing"]
    # 빠르기 구간(tempoMap)이 있는 채보는 박 위치를 이미 따라가므로 bpm 하나로 고치지 않음
    if not tempo.estimated or "tempoMap" in timing:
        return None
    times = [n["timeMs"] for n in chart["charts"][0]["notes"]]
    result = refine_timing(times, float(timing["bpm"]), int(timing["offsetMs"]), min_bpm, max_bpm)
    if result.changed:
        timing["bpm"] = result.bpm
        timing["offsetMs"] = result.offset_ms
    return result


def _require(ok: bool, message: str) -> None:
    if not ok:
        raise ChartOutputError(f"채보 JSON 검증 실패: {message}")


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_chart(chart: dict, duration_ms: int) -> None:
    """BE WorkerResults 검사와 같은 조건. 하나라도 어긋나면 ChartOutputError."""
    _require(chart.get("schemaVersion") == 1, "schemaVersion은 1")
    _require(chart.get("generator") == GENERATOR, f"generator는 {GENERATOR}")
    version = chart.get("generatorVersion")
    _require(
        isinstance(version, str)
        and version.strip() != ""
        and len(version) <= GENERATOR_VERSION_MAX,
        f"generatorVersion은 비어 있지 않은 {GENERATOR_VERSION_MAX}자 이하 문자열",
    )
    _require(isinstance(chart.get("metrics"), dict), "metrics는 객체")
    charts = chart.get("charts")
    _require(isinstance(charts, list) and len(charts) == 1, "charts는 1개")
    c = charts[0]
    _require(c.get("difficulty") == DIFFICULTY, f"difficulty는 {DIFFICULTY}")
    _require(c.get("notationStatus") == NOTATION_STATUS, f"notationStatus는 {NOTATION_STATUS}")
    _require("sheetPages" not in c, "sheetPages는 보내지 않음")
    notes = c.get("notes")
    _require(
        isinstance(notes, list) and len(notes) <= MAX_NOTES, f"notes는 {MAX_NOTES}개 이하 목록"
    )
    seen: set[str] = set()
    previous = -1
    for note in notes:
        note_id = note.get("noteId")
        _require(
            isinstance(note_id, str) and 0 < len(note_id) <= NOTE_ID_MAX and note_id not in seen,
            f"noteId는 1~{NOTE_ID_MAX}자이고 중복 없음: {note_id!r}",
        )
        seen.add(note_id)
        time_ms = note.get("timeMs")
        _require(
            _is_int(time_ms) and 0 <= time_ms <= duration_ms and time_ms >= previous,
            f"timeMs는 0~{duration_ms} 정수이고 오름차순: {time_ms!r}",
        )
        previous = time_ms
        _require(note.get("pad") in _PAD_ORDER, f"pad는 9종 중 하나: {note.get('pad')!r}")
        if "velocityHint" in note:
            v = note["velocityHint"]
            _require(_is_int(v) and 0 <= v <= 127, f"velocityHint는 0~127 정수: {v!r}")
    timing = c.get("timing")
    _require(isinstance(timing, dict), "timing은 객체")
    bpm = timing.get("bpm")
    _require(
        isinstance(bpm, (int, float))
        and not isinstance(bpm, bool)
        and math.isfinite(bpm)
        and BPM_MIN <= bpm <= BPM_MAX,
        f"bpm은 {BPM_MIN}~{BPM_MAX}: {bpm!r}",
    )
    _require(_is_int(timing.get("offsetMs")), "offsetMs는 정수")
    signature = timing.get("timeSignature")
    _require(
        isinstance(signature, str) and 0 < len(signature) <= TIME_SIGNATURE_MAX,
        f"timeSignature는 {TIME_SIGNATURE_MAX}자 이하: {signature!r}",
    )
    _validate_tempo_map(timing)


def _validate_tempo_map(timing: dict) -> None:
    """빠르기가 바뀌는 곡의 ppq·tempoMap·timeSignatureMap. BE ChartDocumentReader.timing과 같은 조건.
    셋 다 선택 필드이고, 있으면 tempoMap 첫 값은 tick 0·bpm == timing.bpm, tick은 계속 커짐."""
    if "ppq" in timing:
        _require(
            _is_int(timing["ppq"]) and timing["ppq"] > 0, f"ppq는 양의 정수: {timing['ppq']!r}"
        )
    if "tempoMap" in timing:
        tempo_map = timing["tempoMap"]
        _require(
            isinstance(tempo_map, list) and len(tempo_map) > 0, "tempoMap은 비어 있지 않은 목록"
        )
        previous = -1
        for t in tempo_map:
            tick, bpm = t.get("tick"), t.get("bpm")
            _require(
                _is_int(tick)
                and tick > previous
                and isinstance(bpm, (int, float))
                and not isinstance(bpm, bool)
                and math.isfinite(bpm)
                and bpm > 0,
                f"tempoMap 항목은 커지는 tick과 양수 bpm: {t!r}",
            )
            previous = tick
        _require(
            tempo_map[0]["tick"] == 0 and tempo_map[0]["bpm"] == timing["bpm"],
            "tempoMap 첫 항목은 tick 0, bpm은 timing.bpm과 같음",
        )
    if "timeSignatureMap" in timing:
        sig_map = timing["timeSignatureMap"]
        _require(
            isinstance(sig_map, list) and len(sig_map) > 0, "timeSignatureMap은 비어 있지 않은 목록"
        )
        previous = -1
        for t in sig_map:
            tick, num, den = t.get("tick"), t.get("numerator"), t.get("denominator")
            _require(
                _is_int(tick)
                and tick > previous
                and _is_int(num)
                and num > 0
                and _is_int(den)
                and den > 0
                and den & (den - 1) == 0,
                f"timeSignatureMap 항목은 커지는 tick, 양수 박자, 2의 거듭제곱 음표: {t!r}",
            )
            previous = tick
        first = sig_map[0]
        _require(
            first["tick"] == 0
            and f"{first['numerator']}/{first['denominator']}" == timing["timeSignature"],
            "timeSignatureMap 첫 항목은 tick 0, timeSignature와 같음",
        )


def notes_by_pad(chart: dict) -> dict[str, int]:
    """패드별 노트 수. 패드 9종 순서, 0개인 패드도 포함."""
    counts = dict.fromkeys(PADS, 0)
    for note in chart["charts"][0]["notes"]:
        counts[note["pad"]] += 1
    return counts
