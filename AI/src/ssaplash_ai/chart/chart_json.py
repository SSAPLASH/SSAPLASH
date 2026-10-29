"""타격 표 → 채보 JSON (설계 3장 "채보 JSON", BE TranscriptionResult schemaVersion 1).

모양: {schemaVersion, generator, generatorVersion, metrics, charts: [{difficulty, notationStatus, notes, timing}]}.
- generator는 BE가 `ADT_MODEL`만 받으므로 고정. 어떤 모델·규칙으로 만들었는지는 generatorVersion에 남김
- charts는 NORMAL 하나, notationStatus는 UNAVAILABLE(악보 표기 없음), sheetPages 없음
- notes: 시각순 정렬 뒤 noteId `n0001`부터. timeMs는 반올림 정수, 0~durationMs로 자름. 같은 시각은
  PADS 순서. 같은 시각·같은 패드가 두 번 나오면 하나만 남김. 세기가 있을 때만 velocityHint

validate_chart는 BE `WorkerResults.java`의 검사를 그대로 옮긴 것. 실패하면 ChartOutputError.
"""

from __future__ import annotations

import math

import numpy as np

from ssaplash_ai.bench.datasets.pads import PADS
from ssaplash_ai.chart.errors import ChartOutputError
from ssaplash_ai.chart.tempo import TempoEstimate

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

_PAD_ORDER = {pad: i for i, pad in enumerate(PADS)}


def build_notes(hits: np.ndarray, duration_ms: int) -> list[dict]:
    """타격 표(HITS_DTYPE) → notes 목록. 패드 8종 밖의 값(거친 라벨 tom·cymbal)이 있으면 ChartOutputError."""
    rows: set[tuple[int, str, int]] = set()
    for row in hits:
        pad = str(row["pad"])
        if pad not in _PAD_ORDER:
            raise ChartOutputError(f"패드 8종 밖의 값이 나옴: {pad} (채보 모델이 8패드를 내야 함)")
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


def build_chart(
    hits: np.ndarray,
    duration_ms: int,
    tempo: TempoEstimate,
    generator_version: str,
    transcribe_ms: int,
    schema_version: int = 1,
) -> dict:
    """채보 JSON dict. 검증은 validate_chart를 따로 부름."""
    return {
        "schemaVersion": schema_version,
        "generator": GENERATOR,
        "generatorVersion": generator_version,
        "metrics": {"transcribeMs": int(transcribe_ms), "durationMs": int(duration_ms)},
        "charts": [
            {
                "difficulty": DIFFICULTY,
                "notationStatus": NOTATION_STATUS,
                "notes": build_notes(hits, duration_ms),
                "timing": {
                    "bpm": tempo.bpm,
                    "offsetMs": 0,
                    "timeSignature": tempo.time_signature,
                },
            }
        ],
    }


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
        _require(note.get("pad") in _PAD_ORDER, f"pad는 8종 중 하나: {note.get('pad')!r}")
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


def notes_by_pad(chart: dict) -> dict[str, int]:
    """패드별 노트 수. PADS 순서, 0개인 패드도 포함."""
    counts = dict.fromkeys(PADS, 0)
    for note in chart["charts"][0]["notes"]:
        counts[note["pad"]] += 1
    return counts
