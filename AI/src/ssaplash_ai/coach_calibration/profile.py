"""분포와 걸림 비율 계산.

- **걸림 비율**: 현재 규칙(임계값)으로 세션을 분석해, 패턴마다 몇 %의 세션에 걸리는지 센다. 한 세션은 같은 패턴을 여러 구간에서
  내도 한 번만 센다. 정답 라벨이 없는 실제 로그에서 쓸 수 있는 지표다.
- **분포**: 오차·놓침·여분 타격·세기를 세션 단위와 타격 단위로 요약한다. 오차는 `goodMs` 비율로 맞춰서 판정 폭이
  다른 세션끼리 섞어도 비교된다.
- **소규모 셀 가림**: 기록(MLflow)에 남기는 값은 `to_record()`로 만들며, 개인 한 명의 값이 드러날 수 있는 작은 집계(5개 미만)를 가린다.
  후보 시험(작업 4)이 쓰는 내부 값은 가리지 않는다.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach.config import DEFAULT_THRESHOLDS, ENABLED_PATTERNS, Thresholds
from ssaplash_ai.coach.schema import AnalysisResponse
from ssaplash_ai.coach_calibration.filters import FilterResult
from ssaplash_ai.coach_calibration.source import Session
from ssaplash_ai.coach_eval.metrics import wilson

MIN_CELL = 5  # 이보다 작은 집계는 기록에서 가린다
QUANTILES = (5, 25, 50, 75, 95)
MIN_VALID_FOR_SESSION_STATS = 10  # 세션 단위 오차 요약을 내려면 필요한 유효 타격 수
MIN_HAND_HITS = 15  # 손별 세기 비교에 필요한 손당 유효 타격 수(분석 엔진과 같은 기준)
PROFILE_VERSION = "profile-1"

GROUP_DRUM = "DRUM"
GROUP_KEYBOARD = "KEYBOARD"


@dataclass(frozen=True)
class FlagRate:
    pattern: str
    sessions_flagged: int
    n_sessions: int

    @property
    def rate(self) -> float:
        return self.sessions_flagged / self.n_sessions if self.n_sessions else 0.0

    @property
    def ci(self) -> tuple[float, float]:
        return wilson(self.sessions_flagged, self.n_sessions)


@dataclass
class GroupProfile:
    group: str
    n_sessions: int
    n_notes: int
    flag_rates: list[FlagRate]
    any_flag: FlagRate
    reasons: Counter[str]
    mean_segments: float
    # 이름 → 값 목록(세션 단위 값 또는 타격 단위 값)과, 그 값을 낸 세션 수
    samples: dict[str, list[float]] = field(default_factory=dict)
    sample_sessions: dict[str, int] = field(default_factory=dict)

    def quantiles(self, name: str) -> dict[int, float] | None:
        values = self.samples.get(name)
        if not values:
            return None
        points = np.percentile(values, QUANTILES)
        return {q: float(v) for q, v in zip(QUANTILES, points, strict=True)}

    def to_record(self) -> dict[str, Any]:
        """기록용 값. 5개 미만 집계는 가리고 걸림 횟수가 1~4면 상한만 남긴다."""
        n = self.n_sessions
        return {
            "group": self.group,
            "nSessions": n,
            "nNotes": self.n_notes,
            "flagRates": {fr.pattern: flag_record(fr) for fr in self.flag_rates},
            "anyFlag": flag_record(self.any_flag),
            "meanSegments": round(self.mean_segments, 3),
            "reasons": dict(self.reasons),
            "distributions": {
                name: self._distribution_record(name) for name in sorted(self.samples)
            },
        }

    def _distribution_record(self, name: str) -> dict[str, Any]:
        contributing = self.sample_sessions.get(name, 0)
        if contributing < MIN_CELL:
            return {"nSessions": None, "masked": True}
        q = self.quantiles(name) or {}
        return {
            "nSessions": contributing,
            "masked": False,
            **{f"q{k:02d}": round(v, 4) for k, v in q.items()},
        }


def flag_record(fr: FlagRate) -> dict[str, Any]:
    n = fr.n_sessions
    if 0 < fr.sessions_flagged < MIN_CELL:
        # 개인의 기록이 드러날 수 있는 작은 집계: 정확한 값 대신 상한만 남긴다
        return {
            "sessions": None,
            "rate": None,
            "ci": None,
            "upperBound": round((MIN_CELL - 1) / n, 4),
        }
    lo, hi = fr.ci
    return {
        "sessions": fr.sessions_flagged,
        "rate": round(fr.rate, 4),
        "ci": [round(lo, 4), round(hi, 4)],
        "upperBound": None,
    }


def analyze_sessions(
    sessions: list[Session], thresholds: Thresholds = DEFAULT_THRESHOLDS
) -> list[AnalysisResponse]:
    """세션마다 분석 엔진을 돌린다. 임계값만 바꿔 같은 세션에 다시 돌릴 수 있다(후보 시험)."""
    return [analyze(AnalysisRequest.model_validate(s.to_request()), thresholds) for s in sessions]


def flag_rates(responses: list[AnalysisResponse]) -> tuple[list[FlagRate], FlagRate, float]:
    """패턴별 걸림(세션당 한 번), 하나라도 걸린 세션, 세션당 평균 구간 수."""
    n = len(responses)
    per_pattern: Counter[str] = Counter()
    any_flagged = 0
    segments = 0
    for response in responses:
        found = {seg.pattern for seg in response.weakSegments}
        per_pattern.update(found)
        any_flagged += bool(found)
        segments += len(response.weakSegments)
    patterns = sorted(set(ENABLED_PATTERNS) | set(per_pattern))
    rates = [FlagRate(p, per_pattern.get(p, 0), n) for p in patterns]
    return rates, FlagRate("ANY", any_flagged, n), (segments / n if n else 0.0)


def build_profile(
    group: str, sessions: list[Session], thresholds: Thresholds = DEFAULT_THRESHOLDS
) -> GroupProfile:
    responses = analyze_sessions(sessions, thresholds)
    rates, any_flag, mean_segments = flag_rates(responses)
    profile = GroupProfile(
        group=group,
        n_sessions=len(sessions),
        n_notes=0,
        flag_rates=rates,
        any_flag=any_flag,
        reasons=Counter(r.reason for r in responses),
        mean_segments=mean_segments,
    )
    _collect_distributions(profile, sessions)
    return profile


def build_profiles(
    filtered: FilterResult, thresholds: Thresholds = DEFAULT_THRESHOLDS
) -> dict[str, GroupProfile]:
    """드럼과 키보드를 따로 만든다. 섞지 않는다."""
    return {
        GROUP_DRUM: build_profile(GROUP_DRUM, filtered.drum, thresholds),
        GROUP_KEYBOARD: build_profile(GROUP_KEYBOARD, filtered.keyboard, thresholds),
    }


def _collect_distributions(profile: GroupProfile, sessions: list[Session]) -> None:
    def add(name: str, values: list[float]) -> None:
        """값을 모으고, 이 값을 낸 세션 수를 센다(세션마다 한 번만 호출한다)."""
        if not values:
            return
        profile.samples.setdefault(name, []).extend(values)
        profile.sample_sessions[name] = profile.sample_sessions.get(name, 0) + 1

    for session in sessions:
        notes = [h for h in session.hits if h["judgement"] in ("PERFECT", "GOOD", "MISS")]
        valid = [h for h in notes if h["judgement"] in ("PERFECT", "GOOD")]
        strays = [h for h in session.hits if h["judgement"] is None]
        profile.n_notes += len(notes)
        if not notes:
            continue
        good = float(session.good_ms)

        add("sessionNotes", [float(len(notes))])
        add("goodMs", [good])
        add("missRate", [sum(h["judgement"] == "MISS" for h in notes) / len(notes)])
        add("strayRate", [len(strays) / len(notes)])

        deltas = [h["delta_ms"] / good for h in valid]
        add("deltaNorm", deltas)  # 타격 단위(모든 세션 합침)
        if len(deltas) >= MIN_VALID_FOR_SESSION_STATS:
            add("sessionDeltaMean", [float(np.mean(deltas))])
            add("sessionDeltaStd", [float(np.std(deltas))])

        add("velocity", [float(h["velocity"]) for h in valid if h["velocity"] is not None])

        ratio = _hand_ratio(valid)
        if ratio is not None:
            add("handRatio", [ratio])


def _hand_ratio(valid: list[dict[str, Any]]) -> float | None:
    """약한 손 평균 세기 ÷ 센 손 평균 세기. 스틱 정보가 없거나 손당 타격이 모자라면 None."""
    by_hand: dict[int, list[float]] = {0: [], 1: []}
    for h in valid:
        if h["stick_id"] in by_hand and h["velocity"] is not None:
            by_hand[h["stick_id"]].append(float(h["velocity"]))
    if min(len(v) for v in by_hand.values()) < MIN_HAND_HITS:
        return None
    means = sorted(float(np.mean(v)) for v in by_hand.values())
    return means[0] / means[1] if means[1] > 0 else None
