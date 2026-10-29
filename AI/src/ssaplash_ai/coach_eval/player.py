"""합성 연주 모델: 채보를 연주해 BE 형식 `hits[]` 요청을 만든다.

임계값이 아니라 **연주 행동**(오차 분포, 놓침 확률, 손별 세기)을 모델링한다. 규칙 임계값을 참조하지 않는다.
판정은 FE 규칙을 따라 한다: 오차 절댓값이 `perfectMs` 이하면 PERFECT, `goodMs` 이하면 GOOD,
그 밖이면 노트는 MISS이고 그 타격은 노트와 맞지 않은 여분의 타격(판정 없음)으로 남는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ssaplash_ai.coach_eval.chart import Note

PERFECT_MS = 25.0
PAD_NAMES = ("HIHAT", "SNARE", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE", "KICK")


@dataclass(frozen=True)
class PlayerModel:
    """연주 습관. 시간 값은 모두 `goodMs`에 대한 비율이라 `goodMs`가 달라도 같은 습관을 뜻한다."""

    # 기본 연주 (정상)
    mean: float = 0.0  # 평균 오차 (늦음 +)
    sigma: float = 0.2  # 오차 표준편차
    p_miss: float = 0.03  # 노트마다 무작위로 놓칠 확률
    p_stray: float = 0.02  # 노트 사이에 여분 타격이 나올 확률
    velocity_mean: float = 90.0
    velocity_sd: float = 10.0
    keyboard: bool = False  # True면 스틱·가속도 정보가 없다(시험용 키보드 입력)

    # 심는 약점 (기본값이면 심지 않음)
    pad_shift: dict[str, float] = field(default_factory=dict)  # 패드별 추가 오차
    transition: tuple[str, str] | None = None  # (이전 패드, 현재 패드)
    transition_shift: float = 0.0  # 그 전환 직후 노트의 추가 오차
    transition_p_miss: float = 0.0  # 그 전환 직후 노트의 놓침 확률(기본보다 높을 때만 적용)
    weak_stick: int | None = None  # 세기가 약한 손(0/1)
    weak_ratio: float = 1.0  # 그 손의 평균 세기 비율
    cluster: tuple[float, float] | None = None  # 놓침이 몰리는 구간 [시작, 끝) ms
    cluster_p_miss: float = 0.0


@dataclass(frozen=True)
class SyntheticPlay:
    request: dict[str, Any]
    model: PlayerModel
    good_ms: float
    chart: list[Note]


def simulate(
    chart: list[Note],
    model: PlayerModel,
    good_ms: float = 50.0,
    seed: int = 0,
    play_id: str | None = None,
) -> SyntheticPlay:
    """채보를 연주한 결과를 BE 요청 형식으로 만든다. 같은 입력·시드면 같은 결과다."""
    rng = np.random.default_rng(seed)
    rows: list[dict[str, Any]] = []
    prev_pad: str | None = None

    for i, note in enumerate(chart):
        stick = None if model.keyboard else i % 2
        mean = model.mean + model.pad_shift.get(note.pad, 0.0)
        p_miss = model.p_miss
        if model.transition and (prev_pad, note.pad) == model.transition:
            mean += model.transition_shift
            p_miss = max(p_miss, model.transition_p_miss)
        if model.cluster and model.cluster[0] <= note.time_ms < model.cluster[1]:
            p_miss = max(p_miss, model.cluster_p_miss)
        prev_pad = note.pad

        if rng.random() < p_miss:
            rows.append(_miss_row(note))
            continue

        delta = float(rng.normal(mean, model.sigma)) * good_ms
        velocity = _velocity(rng, model, stick)
        if abs(delta) > good_ms:
            # 판정 폭 밖: 노트는 놓친 것으로 기록되고, 친 타격은 여분의 타격으로 남는다.
            rows.append(_miss_row(note))
            rows.append(_stray_row(note.time_ms + delta, note.pad, stick, velocity))
        else:
            judgement = "PERFECT" if abs(delta) <= PERFECT_MS else "GOOD"
            rows.append(_hit_row(note, delta, judgement, stick, velocity))

        if i + 1 < len(chart) and rng.random() < model.p_stray:
            gap = chart[i + 1].time_ms - note.time_ms
            pad = PAD_NAMES[int(rng.integers(len(PAD_NAMES)))]
            t = note.time_ms + float(rng.uniform(0.3, 0.7)) * gap
            rows.append(_stray_row(t, pad, stick, _velocity(rng, model, stick)))

    rows.sort(key=lambda r: r["tMs"])
    for seq, row in enumerate(rows):
        row["seq"] = seq
    request = {
        "playId": play_id or f"synthetic-{seed:08d}",
        "songId": 1,
        "chartVersionId": 1,
        "difficulty": "NORMAL",
        "mode": "RHYTHM",
        "timingWindows": {"perfectMs": PERFECT_MS, "goodMs": good_ms},
        "hits": rows,
    }
    return SyntheticPlay(request=request, model=model, good_ms=good_ms, chart=chart)


def _velocity(rng: np.random.Generator, model: PlayerModel, stick: int | None) -> int:
    mean = model.velocity_mean
    if stick is not None and stick == model.weak_stick:
        mean *= model.weak_ratio
    return int(np.clip(round(float(rng.normal(mean, model.velocity_sd))), 1, 127))


def _row(t, pad, stick, velocity, judgement, note_id, delta) -> dict[str, Any]:
    return {
        "seq": 0,
        "tMs": round(t, 3),
        "stickId": stick,
        "pad": pad,
        "baselinePad": pad if judgement in ("PERFECT", "GOOD") else None,
        "predictedPad": None,
        "velocity": velocity,
        "peakAccel": None if velocity is None or stick is None else 12.0,
        "judgement": judgement,
        "matchedNoteId": note_id,
        "deltaMs": None if delta is None else round(delta, 3),
    }


def _hit_row(note: Note, delta: float, judgement: str, stick, velocity) -> dict[str, Any]:
    return _row(note.time_ms + delta, note.pad, stick, velocity, judgement, note.note_id, delta)


def _miss_row(note: Note) -> dict[str, Any]:
    # 놓친 노트: 노트 시각·패드만 있고 나머지는 null (BE 형식)
    return _row(note.time_ms, note.pad, None, None, "MISS", note.note_id, None)


def _stray_row(t: float, pad: str, stick, velocity) -> dict[str, Any]:
    return _row(t, pad, stick, velocity, None, None, None)
