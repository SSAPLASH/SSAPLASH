"""서비스의 R1 규칙 추천 점수(BE `RecommendationScorer`)를 오프라인 입력에 적용하는 파이썬 포팅.

M1(R1 규칙)과 M6(후보 + 규칙 재정렬)이 같은 계수·같은 판단을 쓰도록 한곳에 둔다. 서비스와 계수가 어긋나면
PoC의 비교가 의미 없어지므로 값을 바꿀 때는 BE와 함께 바꾼다.

오프라인과 서비스의 차이(문서화된 근사):
- 서비스는 리포트의 약점 구간(`weak_segments`)을 쓰지만 PoC 입력에는 구간이 없다. 학습 구간 연주의 낮은 정확도와
  채보의 패드 비율로 약한 패드를 근사한다(`weak_pads`).
- 채보 노트 수가 입력에 없어 "NORMAL과 노트 수가 같은 채보 제외" 규칙은 적용하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

W_CHALLENGE, W_WEAK, W_NEW, W_RETRY = 0.45, 0.30, 0.15, 0.10
SWEET_LOW, SWEET_HIGH = 1.10, 1.25
HARD_LIMIT = 1.5
TARGET_ACCURACY, RETRY_FLOOR = 85.0, 70.0
STALE = pd.Timedelta(days=14)
WEAK_SCALE = 2.0
CHALLENGE_REASON_MIN, WEAK_REASON_MIN = 0.8, 0.3
RECENT_PLAYS = 10
WEAK_ACCURACY = 75.0  # 이 미만으로 친 연주를 약점이 있었던 것으로 본다(근사)
WEAK_RECENT = 5
WEAK_DECAY = 0.8

CHALLENGE, WEAK_PAD, NEW_SONG, RETRY, STARTER = (
    "CHALLENGE",
    "WEAK_PAD",
    "NEW_SONG",
    "RETRY",
    "STARTER",
)
_ORDER = (CHALLENGE, WEAK_PAD, NEW_SONG, RETRY)


@dataclass(frozen=True)
class Candidate:
    song_id: int
    chart_id: int
    difficulty: str
    song_level: str
    density: float
    pad_ratio: dict[str, float]


@dataclass(frozen=True)
class Profile:
    """baseline_density가 None이면 기록이 없거나 목표 정확도를 넘긴 판이 없는 사용자다."""

    baseline_density: float | None
    weak_pads: dict[str, float]
    song_last_played: dict[int, pd.Timestamp]
    chart_best_accuracy: dict[int, float]


@dataclass(frozen=True)
class Scored:
    candidate: Candidate
    total: float
    reasons: tuple[str, ...]
    primary: str


def challenge(ratio: float) -> float:
    """기준 밀도 대비 비율이 1.10~1.25면 1점이고 벗어날수록 줄어든다."""
    if SWEET_LOW <= ratio <= SWEET_HIGH:
        return 1.0
    if ratio < SWEET_LOW:
        return max(0.0, 1.0 - (SWEET_LOW - ratio) / 0.6)
    return max(0.0, 1.0 - (ratio - SWEET_HIGH) / (HARD_LIMIT - SWEET_HIGH))


def _score(c: Candidate, ratio: float, profile: Profile, now: pd.Timestamp) -> Scored:
    ch = challenge(ratio)
    weak = min(
        1.0, sum(v * profile.weak_pads.get(pad, 0.0) for pad, v in c.pad_ratio.items()) * WEAK_SCALE
    )
    last = profile.song_last_played.get(c.song_id)
    fresh = 1.0 if last is None else (0.5 if now - last >= STALE else 0.0)
    best = profile.chart_best_accuracy.get(c.chart_id)
    retry = 1.0 if best is not None and RETRY_FLOOR <= best < TARGET_ACCURACY else 0.0
    total = W_CHALLENGE * ch + W_WEAK * weak + W_NEW * fresh + W_RETRY * retry

    parts = {
        CHALLENGE: W_CHALLENGE * ch,
        WEAK_PAD: W_WEAK * weak,
        NEW_SONG: W_NEW * fresh,
        RETRY: W_RETRY * retry,
    }
    reasons = []
    if ch >= CHALLENGE_REASON_MIN:
        reasons.append(CHALLENGE)
    if weak >= WEAK_REASON_MIN:
        reasons.append(WEAK_PAD)
    if fresh >= 1.0:
        reasons.append(NEW_SONG)
    if retry > 0:
        reasons.append(RETRY)
    if not reasons:
        reasons.append(max(_ORDER, key=lambda code: (parts[code], -_ORDER.index(code))))
    primary = max(reasons, key=lambda code: parts[code])  # 같으면 앞선 것(서비스와 같다)
    return Scored(c, round(total, 4), tuple(reasons), primary)


def _better_key(s: Scored) -> tuple[float, int, int]:
    return (-s.total, s.candidate.song_id, s.candidate.chart_id)


def rank(
    candidates: list[Candidate], profile: Profile, now: pd.Timestamp, size: int
) -> list[Scored]:
    """서비스와 같은 규칙: 기준 밀도의 1.5배 초과 제외, 곡당 최고점 채보 하나, 같은 대표 이유는 절반 이하(모자라면 채움)."""
    if profile.baseline_density is None:
        return _starter(candidates, size)
    best = score_songs(candidates, profile, now)
    return _diversify(sorted(best.values(), key=_better_key), size)


def score_songs(
    candidates: list[Candidate], profile: Profile, now: pd.Timestamp
) -> dict[int, Scored]:
    """기준 밀도를 아는 사용자의 곡별 최고점 채보. 기준 밀도의 1.5배를 넘는 채보는 점수와 무관하게 빠진다.

    `rank`의 앞 단계다. 재정렬(`models/rerank.py`)이 후보 곡들에 같은 판단을 적용하려고 따로 쓴다.
    곡의 모든 채보가 한도를 넘으면 그 곡은 결과에 없다.
    """
    if profile.baseline_density is None:
        raise ValueError("기준 밀도가 없는 사용자는 곡별 점수를 낼 수 없습니다.")
    base = profile.baseline_density
    best: dict[int, Scored] = {}
    for c in candidates:
        ratio = c.density / base
        if ratio > HARD_LIMIT:
            continue
        scored = _score(c, ratio, profile, now)
        current = best.get(c.song_id)
        if current is None or _better_key(scored) < _better_key(current):
            best[c.song_id] = scored
    return best


def _starter(candidates: list[Candidate], size: int) -> list[Scored]:
    """기록이 없으면 BEGINNER 곡의 가장 쉬운 채보를 STARTER 이유로 보인다."""
    easiest: dict[int, Candidate] = {}
    for c in candidates:
        if c.song_level != "BEGINNER":
            continue
        cur = easiest.get(c.song_id)
        if cur is None or (c.density, c.chart_id) < (cur.density, cur.chart_id):
            easiest[c.song_id] = c
    ordered = sorted(easiest.values(), key=lambda c: (c.density, c.song_id))[:size]
    return [Scored(c, 0.0, (STARTER,), STARTER) for c in ordered]


def _diversify(ranked: list[Scored], size: int) -> list[Scored]:
    cap = max(1, size // 2)
    picked: list[Scored] = []
    counts: dict[str, int] = {}
    skipped: list[Scored] = []
    for s in ranked:
        if len(picked) >= size:
            break
        if counts.get(s.primary, 0) >= cap:
            skipped.append(s)
            continue
        picked.append(s)
        counts[s.primary] = counts.get(s.primary, 0) + 1
    for s in skipped:
        if len(picked) >= size:
            break
        picked.append(s)
    return sorted(picked, key=_better_key)


def build_profile(
    plays: pd.DataFrame,
    density_of: dict[int, float],
    pad_ratio_of: dict[int, dict[str, float]],
    now: pd.Timestamp,
) -> Profile:
    """한 사용자의 학습 구간 연주(`played_at`, `song_id`, `chart_id`, `accuracy` 열, 시간 오름차순)로 프로필을 만든다."""
    recent = plays.iloc[::-1].head(RECENT_PLAYS)  # 가장 최근 10판
    qualified = [
        density_of[int(c)]
        for c, a in zip(recent["chart_id"], recent["accuracy"], strict=True)
        if a >= TARGET_ACCURACY and int(c) in density_of
    ]
    baseline = max(qualified) if qualified else None

    last_played: dict[int, pd.Timestamp] = {}
    best_accuracy: dict[int, float] = {}
    for song, chart, at, acc in zip(
        plays["song_id"], plays["chart_id"], plays["played_at"], plays["accuracy"], strict=True
    ):
        last_played[int(song)] = max(at, last_played.get(int(song), at))
        best_accuracy[int(chart)] = max(float(acc), best_accuracy.get(int(chart), 0.0))

    weak: dict[str, float] = {}
    decay = 1.0
    for chart, acc in zip(
        recent["chart_id"].head(WEAK_RECENT), recent["accuracy"].head(WEAK_RECENT), strict=True
    ):
        if acc < WEAK_ACCURACY:
            for pad, share in pad_ratio_of.get(int(chart), {}).items():
                severity = min(1.0, share * (WEAK_ACCURACY - acc) / WEAK_ACCURACY * 4)
                weak[pad] = max(weak.get(pad, 0.0), severity * decay)
        decay *= WEAK_DECAY
    return Profile(baseline, weak, last_played, best_accuracy)
