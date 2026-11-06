"""FE 실시간 코칭(`FE/src/coach/live`)의 창·규칙·표시 정책을 그대로 옮겨 합성 연주를 재생한다.

학습 데이터는 "규칙이 실제로 띄운 지적"이어야 해서 FE와 같은 계산이 필요하다.
FE와 어긋나지 않는지는 `tests/coach_live_model/test_replay.py`가 FE에서 뽑은 기록으로 확인한다.
수치는 FE `config.ts`와 같다. 기준 폭은 FE 기본 방식(고정 60ms)이다.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field

BASIS_MS = 60.0
WINDOW_SIZE = 12
HAND_SIZE = 16
MISS_SIZE = 6
PAD_MISS_SIZE = 16
MISS_RELEASE_WINDOW = 4
CAPACITY = max(WINDOW_SIZE, HAND_SIZE, MISS_SIZE, PAD_MISS_SIZE, MISS_RELEASE_WINDOW)
WARMUP = 8
MIN_GAP_MS = 4_000.0
TAG_COOLDOWN_MS = 10_000.0

TREND_MIN_VALID = 8
TREND_SAME_SIGN = 0.75
TREND_MEAN_MS = 0.3 * BASIS_MS
TREND_RELEASE_MS = 0.15 * BASIS_MS
PAD_MIN_HITS = 4
PAD_SAME_SIGN = 1.0
PAD_DIFF_MS = 0.45 * BASIS_MS
PAD_RELEASE_MS = 0.25 * BASIS_MS
PAD_MISS_MIN_TOTAL = 4
PAD_MISS_MIN = 3
PAD_MISS_SHARE = 0.6
PAD_MISS_RATE = 0.5
PAD_MISS_RELEASE_MAX = 1
HAND_MIN = 4
HAND_RATIO = 0.7
HAND_RELEASE_RATIO = 0.8
UNSTEADY_MIN_VALID = 10
UNSTEADY_STD_MS = 0.5 * BASIS_MS
UNSTEADY_RELEASE_MS = 0.35 * BASIS_MS
MISS_STREAK = 3
MISS_IN_WINDOW = 4
MISS_RELEASE_MAX = 1

STICK_PADS = ("CRASH", "HIHAT", "SNARE", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "RIDE")
PRIORITY = {"pad_miss": 0, "miss": 1, "trend": 2, "pad": 3, "hand": 4, "unsteady": 5}


@dataclass(frozen=True)
class JudgedNote:
    song_time_ms: float
    judgement: str
    delta_ms: float | None
    pad: str
    stick_id: int | None
    velocity: float | None


@dataclass(frozen=True)
class PadStat:
    pad: str
    count: int
    mean_delta: float
    same_sign_ratio: float


@dataclass(frozen=True)
class PadMissStat:
    pad: str
    misses: int
    notes: int


@dataclass(frozen=True)
class HandStat:
    count: int
    mean_velocity: float


@dataclass(frozen=True)
class WindowMetrics:
    total: int
    valid_count: int
    mean_delta: float | None
    same_sign_ratio: float | None
    std_delta: float | None
    miss_in_window: int
    miss_in_recent: int
    trailing_misses: int
    miss_in_release: int
    pads: tuple[PadStat, ...]
    miss_in_pad_window: int
    pad_misses: tuple[PadMissStat, ...]
    hands: tuple[HandStat, HandStat]


@dataclass(frozen=True)
class Evaluation:
    key: str
    tag: str
    priority: int
    trigger: bool
    release: bool
    severity: float


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def _is_valid(n: JudgedNote) -> bool:
    return (
        n.judgement in ("PERFECT", "GOOD") and n.delta_ms is not None and math.isfinite(n.delta_ms)
    )


class JudgedWindow:
    def __init__(self) -> None:
        self.buf: list[JudgedNote] = []
        self.seen = 0

    def push(self, note: JudgedNote) -> None:
        self.buf.append(note)
        if len(self.buf) > CAPACITY:
            self.buf.pop(0)
        self.seen += 1

    def metrics(self) -> WindowMetrics:
        recent = self.buf[-WINDOW_SIZE:]
        valid = [v for v in recent if _is_valid(v)]
        deltas = [float(v.delta_ms) for v in valid]  # type: ignore[arg-type]
        n = len(deltas)
        mean = std = same = None
        if n:
            mean = sum(deltas) / n
            std = math.sqrt(sum((d - mean) ** 2 for d in deltas) / n)
            sign = _sign(mean)
            same = 0.0 if sign == 0 else sum(_sign(d) == sign for d in deltas) / n

        trailing = 0
        for note in reversed(self.buf):
            if note.judgement != "MISS":
                break
            trailing += 1

        by_pad: dict[str, list[float]] = {}
        for v in valid:
            by_pad.setdefault(v.pad, []).append(float(v.delta_ms))  # type: ignore[arg-type]
        pads = []
        for pad, ds in by_pad.items():
            pad_mean = sum(ds) / len(ds)
            sign = _sign(pad_mean)
            ratio = 0.0 if sign == 0 else sum(_sign(d) == sign for d in ds) / len(ds)
            pads.append(PadStat(pad, len(ds), pad_mean, ratio))

        pad_recent = self.buf[-PAD_MISS_SIZE:]
        miss_by_pad: dict[str, list[int]] = {}
        for v in pad_recent:
            stat = miss_by_pad.setdefault(v.pad, [0, 0])
            stat[1] += 1
            if v.judgement == "MISS":
                stat[0] += 1

        sums = [0.0, 0.0]
        counts = [0, 0]
        for v in self.buf[-HAND_SIZE:]:
            if (
                not _is_valid(v)
                or v.stick_id not in (0, 1)
                or v.velocity is None
                or not math.isfinite(v.velocity)
            ):
                continue
            sums[v.stick_id] += v.velocity
            counts[v.stick_id] += 1

        def misses(items: Iterable[JudgedNote]) -> int:
            return sum(x.judgement == "MISS" for x in items)

        return WindowMetrics(
            total=self.seen,
            valid_count=n,
            mean_delta=mean,
            same_sign_ratio=same,
            std_delta=std,
            miss_in_window=misses(recent),
            miss_in_recent=misses(self.buf[-MISS_SIZE:]),
            trailing_misses=trailing,
            miss_in_release=misses(self.buf[-MISS_RELEASE_WINDOW:]),
            pads=tuple(pads),
            miss_in_pad_window=misses(pad_recent),
            pad_misses=tuple(PadMissStat(p, s[0], s[1]) for p, s in miss_by_pad.items()),
            hands=(
                HandStat(counts[0], sums[0] / counts[0] if counts[0] else 0.0),
                HandStat(counts[1], sums[1] / counts[1] if counts[1] else 0.0),
            ),
        )


def evaluate_rules(m: WindowMetrics) -> list[Evaluation]:
    out: list[Evaluation] = []

    for pad in STICK_PADS:
        s = next((p for p in m.pad_misses if p.pad == pad), None)
        missed = s.misses if s else 0
        rate = missed / s.notes if s and s.notes > 0 else 0.0
        trigger = (
            m.miss_in_pad_window >= PAD_MISS_MIN_TOTAL
            and missed >= PAD_MISS_MIN
            and missed / m.miss_in_pad_window >= PAD_MISS_SHARE
            and rate >= PAD_MISS_RATE
        )
        out.append(
            Evaluation(
                f"LIVE_PAD_MISS:{pad}",
                "LIVE_PAD_MISS",
                PRIORITY["pad_miss"],
                trigger,
                missed <= PAD_MISS_RELEASE_MAX,
                _clamp01(rate),
            )
        )

    miss_rate = max(m.miss_in_recent, m.trailing_misses) / MISS_SIZE
    out.append(
        Evaluation(
            "LIVE_MISS_STREAK",
            "LIVE_MISS_STREAK",
            PRIORITY["miss"],
            m.trailing_misses >= MISS_STREAK or m.miss_in_recent >= MISS_IN_WINDOW,
            m.miss_in_release <= MISS_RELEASE_MAX,
            _clamp01(miss_rate / 0.6),
        )
    )

    mean = m.mean_delta
    trend_enough = (
        mean is not None
        and m.valid_count >= TREND_MIN_VALID
        and (m.same_sign_ratio or 0.0) >= TREND_SAME_SIGN
    )
    trend_severity = 0.0 if mean is None else _clamp01(abs(mean) / (1.2 * BASIS_MS))
    out.append(
        Evaluation(
            "LIVE_LATE",
            "LIVE_LATE",
            PRIORITY["trend"],
            bool(trend_enough and mean > 0 and abs(mean) >= TREND_MEAN_MS),
            mean is not None and mean <= TREND_RELEASE_MS,
            trend_severity,
        )
    )
    out.append(
        Evaluation(
            "LIVE_EARLY",
            "LIVE_EARLY",
            PRIORITY["trend"],
            bool(trend_enough and mean < 0 and abs(mean) >= TREND_MEAN_MS),
            mean is not None and mean >= -TREND_RELEASE_MS,
            trend_severity,
        )
    )

    for pad in STICK_PADS:
        s = next((p for p in m.pads if p.pad == pad), None)
        others_count = m.valid_count - s.count if s else 0
        others_mean = None
        if s and mean is not None and others_count >= PAD_MIN_HITS:
            others_mean = (m.valid_count * mean - s.count * s.mean_delta) / others_count
        diff = (
            s.mean_delta - others_mean
            if s and s.count >= PAD_MIN_HITS and others_mean is not None
            else None
        )
        severity = _clamp01(abs(s.mean_delta) / (1.2 * BASIS_MS)) if s else 0.0
        release = diff is not None and abs(diff) < PAD_RELEASE_MS
        late = (
            diff is not None
            and s is not None
            and diff >= PAD_DIFF_MS
            and s.mean_delta > 0
            and s.same_sign_ratio >= PAD_SAME_SIGN
        )
        early = (
            diff is not None
            and s is not None
            and diff <= -PAD_DIFF_MS
            and s.mean_delta < 0
            and s.same_sign_ratio >= PAD_SAME_SIGN
        )
        out.append(
            Evaluation(
                f"LIVE_PAD_LATE:{pad}", "LIVE_PAD_LATE", PRIORITY["pad"], late, release, severity
            )
        )
        out.append(
            Evaluation(
                f"LIVE_PAD_EARLY:{pad}", "LIVE_PAD_EARLY", PRIORITY["pad"], early, release, severity
            )
        )

    h0, h1 = m.hands
    hands_ok = (
        h0.count >= HAND_MIN
        and h1.count >= HAND_MIN
        and h0.mean_velocity > 0
        and h1.mean_velocity > 0
    )
    for hand in (0, 1):
        ratio = m.hands[hand].mean_velocity / m.hands[1 - hand].mean_velocity if hands_ok else None
        out.append(
            Evaluation(
                f"LIVE_HAND_WEAK:{hand}",
                "LIVE_HAND_WEAK",
                PRIORITY["hand"],
                ratio is not None and ratio < HAND_RATIO,
                ratio is not None and ratio >= HAND_RELEASE_RATIO,
                0.0 if ratio is None else _clamp01((1 - ratio) / 0.5),
            )
        )

    std = m.std_delta
    out.append(
        Evaluation(
            "LIVE_UNSTEADY",
            "LIVE_UNSTEADY",
            PRIORITY["unsteady"],
            std is not None and m.valid_count >= UNSTEADY_MIN_VALID and std >= UNSTEADY_STD_MS,
            std is not None and std < UNSTEADY_RELEASE_MS,
            0.0 if std is None else _clamp01(std / (0.8 * BASIS_MS)),
        )
    )
    return out


@dataclass
class _KeyState:
    active: bool
    last_shown_ms: float


@dataclass
class CorrectionPolicy:
    """FE `CoachPolicy`의 지적 부분. 칭찬은 지적의 간격과 쿨다운을 바꾸지 않아 옮기지 않는다."""

    states: dict[str, _KeyState] = field(default_factory=dict)
    last_correction_ms: float | None = None

    def decide(
        self, evals: list[Evaluation], song_time_ms: float, judged: int
    ) -> Evaluation | None:
        for e in evals:
            st = self.states.get(e.key)
            if st and st.active and e.release:
                st.active = False
        if judged < WARMUP:
            return None
        if (
            self.last_correction_ms is not None
            and song_time_ms - self.last_correction_ms < MIN_GAP_MS
        ):
            return None
        candidates = []
        for e in evals:
            if not e.trigger:
                continue
            st = self.states.get(e.key)
            if st is None or not st.active or song_time_ms - st.last_shown_ms >= TAG_COOLDOWN_MS:
                candidates.append(e)
        if not candidates:
            return None
        pick = sorted(candidates, key=lambda e: (e.priority, -e.severity))[0]
        self.states[pick.key] = _KeyState(True, song_time_ms)
        self.last_correction_ms = song_time_ms
        return pick


@dataclass(frozen=True)
class Firing:
    """규칙이 띄운 지적 한 건과 그때의 지표."""

    index: int
    key: str
    tag: str
    metrics: WindowMetrics


def replay(notes: Iterable[JudgedNote]) -> list[Firing]:
    window = JudgedWindow()
    policy = CorrectionPolicy()
    fired: list[Firing] = []
    for i, note in enumerate(notes):
        if not math.isfinite(note.song_time_ms):
            continue
        window.push(note)
        m = window.metrics()
        pick = policy.decide(evaluate_rules(m), note.song_time_ms, window.seen)
        if pick is not None:
            fired.append(Firing(i, pick.key, pick.tag, m))
    return fired
