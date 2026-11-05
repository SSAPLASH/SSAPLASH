"""보정 배치 시험용 합성 뷰 행 만들기.

139번 평가 도구(`coach_eval`)로 연주를 만들고, BE가 만들 비식별 뷰(`coach_export_v`)와 같은 열 구성의 행으로 바꾼다.
pytest가 tests/ 를 sys.path에 넣으므로 `from calibration_helpers import ...`로 사용.
"""

from __future__ import annotations

from typing import Any

from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.player import PlayerModel, simulate


def synthetic_request(
    seed: int = 0, n_notes: int = 60, model: PlayerModel | None = None, good_ms: float = 60.0
) -> dict[str, Any]:
    chart = make_chart(n_notes, "random", seed=seed)
    play = simulate(chart, model or PlayerModel(), good_ms=good_ms, seed=seed)
    return play.request


def view_rows(
    request: dict[str, Any],
    session_key: str | None = None,
    input_source: str = "STICK",
    difficulty: str | None = "NORMAL",
    song_ref: int | None = 1,
    song_origin: str = "PUBLIC",
    with_difficulty: bool = True,
) -> list[dict[str, Any]]:
    """합성 요청 한 건을 뷰 행(타격 한 건이 한 줄)으로 바꾼다."""
    key = session_key or request["playId"]
    windows = request["timingWindows"]
    rows = []
    for h in request["hits"]:
        row = {
            "session_key": key,
            "mode": request["mode"],
            "input_source": input_source,
            "song_ref": song_ref,
            "song_origin": song_origin,
            "perfect_ms": windows["perfectMs"],
            "good_ms": windows["goodMs"],
            "played_date": "2026-10-29",
            "payload_schema_version": 1,
            "seq": h["seq"],
            "t_ms": h["tMs"],
            "stick_id": h["stickId"],
            "pad": h["pad"],
            "velocity": h["velocity"],
            "peak_accel": h["peakAccel"],
            "judgement": h["judgement"],
            "matched_note_id": h["matchedNoteId"],
            "delta_ms": h["deltaMs"],
        }
        if with_difficulty:
            row["difficulty"] = difficulty
        rows.append(row)
    return rows


def late_gradient_rows(count: int = 60, start: int = 0, n_notes: int = 80) -> list[dict[str, Any]]:
    """평균 지연이 0.1~0.5 × goodMs로 고르게 퍼진 집단의 뷰 행. 세션 키는 `start`부터 이어서 붙인다."""
    rows: list[dict[str, Any]] = []
    for i in range(count):
        model = PlayerModel(
            mean=0.1 + 0.4 * i / max(count - 1, 1), sigma=0.05, p_miss=0.0, p_stray=0.0
        )
        seed = start + i
        chart = make_chart(n_notes, "rock", seed=seed)
        request = simulate(chart, model, good_ms=60.0, seed=seed).request
        rows += view_rows(request, session_key=f"sess{seed:05d}")
    return rows
