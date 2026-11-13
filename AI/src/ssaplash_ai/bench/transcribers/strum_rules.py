"""STRUM CRNN 프레임별 점수 → 노트. numpy·scipy만 사용.

흐름: pick_peaks(패드별 피크 찾기) → apply_kick_gain(킥이 탐으로 잡히는 곡 보정) → to_hits(패드별 문턱값).
점수는 실험과 같이 1000을 곱해 반올림한 정수로 다룸. 값은 모델 yaml의 rules에서 읽음.

킥 규칙. 드럼 세트에 따라 킥이 탐으로 잡히는 곡(ENST 드러머 1: 킥 정답 시각의 점수 중앙값이 킥 0.34, 플로어 탐 0.67)
1. 문턱값을 넘는 탐 피크 수가 킥 피크 수보다 많은 곡만 대상
2. 그 곡의 킥 피크 점수(floor 이상) percentile 백분위가 기준값 target보다 낮으면 그 비율만큼 킥 점수를 키움(최대 max_gain배)
3. 키운 뒤 문턱값을 넘는 킥에서 near_ms 안에 있는 탐 피크는 지움(같은 타격이 킥과 탐으로 같이 잡힌 것)
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from ssaplash_ai.bench.transcribers.transcriber_base import RawHit

PADS: tuple[str, ...] = (
    "KICK",
    "SNARE",
    "HIHAT",
    "SMALL_TOM",
    "MID_TOM",
    "FLOOR_TOM",
    "CRASH",
    "RIDE",
)
TOMS: tuple[str, ...] = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
SCORE_SCALE = 1000

DEFAULT_RULES: dict = {
    "peak_floor": 0.1,
    "peak_gap_ms": 30.0,
    "offset_ms": 0.0,
    "thresholds": {},
    "kick_gain": None,
}
DEFAULT_KICK_GAIN: dict = {
    "percentile": 90.0,
    "floor": 0.2,
    "min_peaks": 20,
    "max_gain": 2.5,
    "near_ms": 30.0,
}


@dataclass
class Peaks:
    """곡 하나의 피크 목록. 세 배열 길이가 같고 시각 오름차순."""

    frame: np.ndarray  # 프레임 번호 (int64)
    pad: np.ndarray  # 패드 이름
    score: np.ndarray  # 점수 × 1000 정수 (int64)


@dataclass
class KickGainResult:
    """킥 규칙 적용 결과. 대상이 아니면 gain 1.0."""

    applied: bool = False
    gain: float = 1.0
    n_kick: int = 0
    n_tom: int = 0
    n_tom_dropped: int = 0


def rules_with_defaults(rules: dict | None) -> dict:
    """yaml rules + 기본값. 문턱값이 패드 8종 전부 있는지, 값 범위 검사."""
    raw = dict(rules or {})
    unknown = sorted(set(raw) - set(DEFAULT_RULES))
    if unknown:
        raise ValueError(f"모르는 STRUM rules 필드: {unknown}")
    out = {**DEFAULT_RULES, **raw}
    thresholds = {str(k): float(v) for k, v in (raw.get("thresholds") or {}).items()}
    missing = [p for p in PADS if p not in thresholds]
    if missing or len(thresholds) != len(PADS):
        raise ValueError(f"rules.thresholds에 패드 8종이 모두 필요. 없음: {missing}")
    if not all(0.0 < v <= 1.0 for v in thresholds.values()):
        raise ValueError(f"rules.thresholds는 0 초과 1 이하: {thresholds}")
    out["thresholds"] = thresholds
    if not 0.0 < float(out["peak_floor"]) <= 1.0 or float(out["peak_gap_ms"]) <= 0:
        raise ValueError("rules.peak_floor는 0 초과 1 이하, peak_gap_ms는 양수")
    if raw.get("kick_gain") is not None:
        kg = dict(raw["kick_gain"])
        unknown = sorted(set(kg) - set(DEFAULT_KICK_GAIN) - {"target"})
        if unknown:
            raise ValueError(f"모르는 rules.kick_gain 필드: {unknown}")
        if "target" not in kg:
            raise ValueError("rules.kick_gain.target(킥 점수 기준값)이 필요")
        kg = {**DEFAULT_KICK_GAIN, **kg}
        if not 0.0 < float(kg["target"]) <= 1.0 or float(kg["max_gain"]) < 1.0:
            raise ValueError("rules.kick_gain.target은 0 초과 1 이하, max_gain은 1 이상")
        out["kick_gain"] = kg
    return out


def _scaled(value: float) -> int:
    return int(round(float(value) * SCORE_SCALE))


def pick_peaks(
    acts: np.ndarray, names: Sequence[str], fps: float, floor: float, gap_ms: float
) -> Peaks:
    """프레임별 점수 (프레임, 패드 수) → 패드별 피크. floor 미만은 버리고 같은 패드 최소 간격 gap_ms."""
    from scipy.signal import find_peaks

    acts = np.asarray(acts, dtype=np.float32)
    gap = max(1, int(round(gap_ms / 1000.0 * fps)))
    frames, pads, scores = [], [], []
    for ci, name in enumerate(names):
        idx, props = find_peaks(acts[:, ci], height=floor, distance=gap)
        frames.append(idx.astype(np.int64))
        pads.extend([str(name)] * len(idx))
        scores.append(np.rint(props["peak_heights"] * SCORE_SCALE).astype(np.int64))
    frame = np.concatenate(frames) if frames else np.zeros(0, dtype=np.int64)
    score = np.concatenate(scores) if scores else np.zeros(0, dtype=np.int64)
    order = np.argsort(frame, kind="stable")
    return Peaks(frame=frame[order], pad=np.asarray(pads, dtype="U16")[order], score=score[order])


def _nearest_gap(times: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """times 각각에서 가장 가까운 ref까지의 거리. ref는 오름차순이고 비어 있지 않음."""
    pos = np.searchsorted(ref, times)
    right = np.abs(ref[np.clip(pos, 0, len(ref) - 1)] - times)
    left = np.abs(ref[np.clip(pos - 1, 0, len(ref) - 1)] - times)
    return np.minimum(left, right)


def apply_kick_gain(
    peaks: Peaks, fps: float, thresholds: dict[str, float], kick_gain: dict | None
) -> tuple[Peaks, KickGainResult]:
    """킥 규칙(모듈 설명 1~3번)을 적용한 피크와 적용 결과. kick_gain이 None이면 그대로."""
    thr = {p: _scaled(v) for p, v in thresholds.items()}
    is_kick = peaks.pad == "KICK"
    score = peaks.score.astype(np.float64)
    result = KickGainResult(
        n_kick=int((score[is_kick] >= thr["KICK"]).sum()),
        n_tom=sum(int((score[peaks.pad == t] >= thr[t]).sum()) for t in TOMS),
    )
    if kick_gain is None or result.n_tom <= result.n_kick:
        return peaks, result
    counted = score[is_kick & (score >= _scaled(kick_gain["floor"]))]
    if len(counted) < int(kick_gain["min_peaks"]):
        return peaks, result
    level = float(np.percentile(counted, float(kick_gain["percentile"])))
    gain = float(
        np.clip(float(kick_gain["target"]) * SCORE_SCALE / level, 1.0, kick_gain["max_gain"])
    )
    if gain <= 1.0:
        return peaks, result
    score[is_kick] = np.minimum(score[is_kick] * gain, SCORE_SCALE)
    result.applied, result.gain = True, gain
    times = peaks.frame / fps
    strong = np.sort(times[is_kick & (score >= thr["KICK"])])
    if len(strong):
        near = float(kick_gain["near_ms"]) / 1000.0
        for tom in TOMS:
            idx = np.flatnonzero(peaks.pad == tom)
            hit = idx[_nearest_gap(times[idx], strong) <= near]
            result.n_tom_dropped += int((score[hit] >= thr[tom]).sum())
            score[hit] = 0
    out = Peaks(frame=peaks.frame, pad=peaks.pad, score=np.rint(score).astype(np.int64))
    return out, result


def to_hits(
    peaks: Peaks, fps: float, thresholds: dict[str, float], offset_ms: float = 0.0
) -> list[RawHit]:
    """패드별 문턱값 이상인 피크만 (시각 초, 패드 이름, None) 목록으로. 시각 오름차순."""
    thr = np.array([_scaled(thresholds[str(p)]) for p in peaks.pad], dtype=np.int64)
    keep = peaks.score >= thr
    times = peaks.frame[keep] / fps + offset_ms / 1000.0
    return [(float(t), str(p), None) for t, p in zip(times, peaks.pad[keep], strict=True)]


def acts_to_hits(
    acts: np.ndarray, names: Sequence[str], fps: float, rules: dict | None
) -> tuple[list[RawHit], KickGainResult]:
    """프레임별 점수 → 노트 목록과 킥 규칙 적용 결과. names는 점수 열 순서의 패드 이름."""
    r = rules_with_defaults(rules)
    peaks = pick_peaks(acts, names, fps, float(r["peak_floor"]), float(r["peak_gap_ms"]))
    peaks, result = apply_kick_gain(peaks, fps, r["thresholds"], r["kick_gain"])
    return to_hits(peaks, fps, r["thresholds"], float(r["offset_ms"])), result
