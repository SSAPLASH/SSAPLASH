"""약점 분석 테스트용 합성 로그 빌더.

노트 목록(`N`)을 주면 BE `hits[]` 형식의 요청을 만든다. 노트는 `t0`부터 `step_ms` 간격이다.
pytest가 tests/ 를 sys.path에 넣으므로 `from coach_helpers import ...`로 사용.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach.config import Thresholds

PERFECT_MS = 25.0
AUTO = -2  # 스틱 번호를 노트 순서(0/1 번갈아)로 정한다


@dataclass
class N:
    """채보 노트 한 개의 연주 결과. `delta`가 None이면 놓친 노트다."""

    pad: str = "SNARE"
    delta: float | None = 0.0
    velocity: int | None = 90
    stick: int | None = AUTO  # None은 스틱 정보 없음(키보드)


def same(count: int, **kwargs: Any) -> list[N]:
    return [N(**kwargs) for _ in range(count)]


def build_request(
    notes: list[N],
    good_ms: float = 50.0,
    t0: float = 1000.0,
    step_ms: float = 500.0,
    strays: tuple[tuple[float, str, int], ...] = (),
    mode: str = "RHYTHM",
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for i, n in enumerate(notes):
        note_time = t0 + i * step_ms
        if n.delta is None:
            rows.append(_row(note_time, n.pad, None, None, "MISS", f"n{i + 1:04d}", None))
            continue
        stick = i % 2 if n.stick == AUTO else n.stick
        judgement = "PERFECT" if abs(n.delta) <= PERFECT_MS else "GOOD"
        rows.append(
            _row(note_time + n.delta, n.pad, stick, n.velocity, judgement, f"n{i + 1:04d}", n.delta)
        )
    for t, pad, velocity in strays:
        rows.append(_row(t, pad, 0, velocity, None, None, None))
    rows.sort(key=lambda r: r["tMs"])
    for seq, row in enumerate(rows):
        row["seq"] = seq
    return {
        "playId": "6f1c2d3e-0a1b-4c5d-8e9f-001122334455",
        "songId": 12,
        "chartVersionId": 34,
        "difficulty": "NORMAL",
        "mode": mode,
        "timingWindows": {"perfectMs": PERFECT_MS, "goodMs": good_ms},
        "hits": rows,
    }


def _row(t, pad, stick, velocity, judgement, note_id, delta) -> dict[str, Any]:
    return {
        "seq": 0,
        "tMs": t,
        "stickId": stick,
        "pad": pad,
        "baselinePad": None if judgement in (None, "MISS") else pad,
        "predictedPad": None,
        "velocity": velocity,
        "peakAccel": None if velocity is None else 12.0,
        "judgement": judgement,
        "matchedNoteId": note_id,
        "deltaMs": delta,
    }


# 비율 경계를 ms로 검사하는 시험용: 기준 폭이 플레이의 판정 폭(이전 동작). 기본 설정(고정 60ms)은 test_basis.py가 본다.
LEGACY = Thresholds(basis_ms=None)


def run(notes: list[N], thresholds: Thresholds = LEGACY, **kwargs: Any) -> dict[str, Any]:
    """노트 목록으로 분석하고 응답을 dict로 돌려준다. 기본은 `LEGACY`(기준 폭 = 판정 폭)."""
    request = AnalysisRequest.model_validate(build_request(notes, **kwargs))
    return analyze(request, thresholds).model_dump()


def patterns_of(response: dict[str, Any]) -> list[str]:
    return [s["pattern"] for s in response["weakSegments"]]


def find(response: dict[str, Any], pattern: str) -> list[dict[str, Any]]:
    return [s for s in response["weakSegments"] if s["pattern"] == pattern]
