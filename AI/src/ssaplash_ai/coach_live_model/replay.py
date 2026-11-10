"""FE 실시간 코칭(`FE/src/coach/live`)의 창·규칙·표시 정책·놓침 원인을 그대로 옮겨 합성 연주를 재생한다.

학습 데이터는 "규칙이 실제로 띄운 지적"이어야 해서 FE와 같은 계산이 필요하다.
FE와 어긋나지 않는지는 `tests/coach_live_model/test_replay.py`가 FE에서 뽑은 기록으로 확인한다.
수치는 FE `config.ts`와 같다. 기준 폭은 FE 기본 방식(고정 60ms)이다.
판정 단계는 FE `coachStage`, 놓침 원인은 FE `cause.ts`, 원인을 붙이는 조건은 FE `LiveCoach.decideCause`와 같다.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

BASIS_MS = 60.0
WINDOW_SIZE = 12
HAND_SIZE = 16
MISS_SIZE = 6
PAD_MISS_SIZE = 16
MISS_RELEASE_WINDOW = 4
CAUSE_WINDOW = 16
CAPACITY = max(WINDOW_SIZE, HAND_SIZE, MISS_SIZE, PAD_MISS_SIZE, MISS_RELEASE_WINDOW, CAUSE_WINDOW)
STRAY_CAPACITY = 32
MIN_GAP_MS = 4_000.0
TAG_COOLDOWN_MS = 10_000.0

# 판정 단계(FE `config.ts`의 stages). 판정 4개 전 무표시, 4부터 연속 놓침만, 8부터 전부, 16부터 원인 전부
STAGE_FIRST = 4
STAGE_SECOND = 8
STAGE_THIRD = 16
STAGE1_TAGS = frozenset({"LIVE_MISS_STREAK"})

# 놓침 원인(FE `config.ts`의 cause). 가정값이다
CAUSE_MIN_MISSES = 2
DENSE_GAP_RATIO = 0.6
DENSE_SHARE = 0.6
WRONG_PAD_NEAR_COEF = 2.0
WRONG_PAD_SHARE = 0.5
TRANSITION_MIN_REPEAT = 2
TRANSITION_SHARE = 0.5
TRANSITION_RATE = 0.5
# 같은 패드를 다른 곳에서 넘어와 친 노트가 이만큼은 있어야 비교한다
TRANSITION_MIN_CONTRAST = 2
# 그 이동의 놓침 비율이 비교 대상 놓침 비율의 몇 배 이상이어야 하나
TRANSITION_LIFT = 2.5
DRIFT_LOOKBACK = 3
DRIFT_LATE_COEF = 0.3
DRIFT_RISE_COEF = 0.2
DRIFT_SHARE = 0.5
# 원인을 붙이는 놓침 지적과 그 시작 단계(FE `LiveCoach`의 CAUSE_TAGS, CAUSE_MIN_STAGE)
CAUSE_TAGS = frozenset({"LIVE_PAD_MISS", "LIVE_MISS_STREAK"})
CAUSE_MIN_STAGE = 2
STAGE_CAUSES: dict[int, tuple[str, ...]] = {
    0: (),
    1: (),
    2: ("WRONG_PAD", "DENSE"),
    3: ("WRONG_PAD", "TRANSITION", "DENSE", "DRIFT_LATE"),
}
# 모델 없이 고르는 순서. 구체적으로 고칠 수 있는 원인이 먼저다
RULE_ORDER = ("WRONG_PAD", "TRANSITION", "DENSE", "DRIFT_LATE")
CAUSES = (*RULE_ORDER, "UNKNOWN")

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
    """판정 한 건. 뒤의 세 필드는 원인 계산용이고 없으면 그 원인을 계산하지 않는다(FE와 같다)."""

    song_time_ms: float
    judgement: str
    delta_ms: float | None
    pad: str
    stick_id: int | None
    velocity: float | None
    # 노트 시각. 없으면 곡 시각을 쓴다
    note_time_ms: float | None = None
    # 직전 시점(같은 시각 노트 묶음)의 패드들
    prev_pads: tuple[str, ...] | None = None
    # 직전 시점과의 간격
    prev_gap_ms: float | None = None

    @property
    def note_time(self) -> float:
        return self.song_time_ms if self.note_time_ms is None else self.note_time_ms


@dataclass(frozen=True)
class StrayHit:
    """채보 밖 타격(FE `RhythmSession.onStray`)."""

    pad: str
    song_time_ms: float


@dataclass(frozen=True)
class CauseCandidate:
    cause: str
    # 0~1. 그 원인으로 설명되는 놓침의 비율
    strength: float
    # 놓친 노트의 패드. 여러 패드면 가장 많이 놓친 패드
    pad: str | None
    from_pad: str | None = None
    into_pad: str | None = None


UNKNOWN_CAUSE = CauseCandidate("UNKNOWN", 0.0, None)


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
        self.stray_buf: list[StrayHit] = []
        self.seen = 0

    def push(self, note: JudgedNote) -> None:
        self.buf.append(note)
        if len(self.buf) > CAPACITY:
            self.buf.pop(0)
        self.seen += 1

    def push_stray(self, stray: StrayHit) -> None:
        self.stray_buf.append(stray)
        if len(self.stray_buf) > STRAY_CAPACITY:
            self.stray_buf.pop(0)

    def recent(self, n: int) -> list[JudgedNote]:
        return self.buf[-n:]

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
        stage = coach_stage(judged)
        if stage == 0:
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
            if stage == 1 and e.tag not in STAGE1_TAGS:
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


def coach_stage(judged: int) -> int:
    """판정 단계. 0이면 아무것도 띄우지 않는다(FE `coachStage`)."""
    if judged >= STAGE_THIRD:
        return 3
    if judged >= STAGE_SECOND:
        return 2
    if judged >= STAGE_FIRST:
        return 1
    return 0


def _most_common(xs: Sequence[str]) -> str | None:
    """가장 많은 값. 동률이면 그 개수에 먼저 도달한 값(FE `mostCommon`과 같은 순회)."""
    counts: Counter[str] = Counter()
    best: str | None = None
    best_count = 0
    for x in xs:
        counts[x] += 1
        if counts[x] > best_count:
            best, best_count = x, counts[x]
    return best


def _dense(misses: Sequence[JudgedNote], median: float | None) -> float | None:
    if median is None or not median > 0:
        return None
    known = [m for m in misses if m.prev_gap_ms is not None]
    if len(known) < CAUSE_MIN_MISSES:
        return None
    hits = sum(m.prev_gap_ms <= DENSE_GAP_RATIO * median for m in known)  # type: ignore[operator]
    share = hits / len(known)
    return share if hits >= CAUSE_MIN_MISSES and share >= DENSE_SHARE else None


def _wrong_pad(
    misses: Sequence[JudgedNote], strays: Sequence[StrayHit], good_ms: float
) -> tuple[float, str] | None:
    near = WRONG_PAD_NEAR_COEF * good_ms
    into: list[str] = []
    for m in misses:
        close = [s for s in strays if s.pad != m.pad and abs(s.song_time_ms - m.note_time) <= near]
        if not close:
            continue
        # 가장 가까운 타격을 그 놓침 대신 친 것으로 본다. 같으면 먼저 들어온 타격(FE 정렬은 안정 정렬)
        close.sort(key=lambda s: abs(s.song_time_ms - m.note_time))
        into.append(close[0].pad)
    share = len(into) / len(misses)
    top = _most_common(into)
    if top is None or len(into) < CAUSE_MIN_MISSES or share < WRONG_PAD_SHARE:
        return None
    return share, top


def _from_pads(n: JudgedNote) -> list[str]:
    """손으로 옮겨 가는 이동만 본다. 킥 같은 페달에서 넘어오는 것은 손 이동이 아니다."""
    return [p for p in (n.prev_pads or ()) if p != n.pad and p in STICK_PADS]


def _transition(
    ordered: Sequence[JudgedNote], misses: Sequence[JudgedNote]
) -> tuple[float, str, str] | None:
    counts: dict[tuple[str, str], int] = {}
    for m in misses:
        for f in _from_pads(m):
            counts[(f, m.pad)] = counts.get((f, m.pad), 0) + 1
    best: tuple[float, float, str, str] | None = None
    for (src, dst), count in counts.items():
        if count < TRANSITION_MIN_REPEAT:
            continue
        moved = [n for n in ordered if n.pad == dst and src in _from_pads(n)]
        rate = 0.0 if not moved else count / len(moved)
        share = count / len(misses)
        # 같은 패드를 다른 곳에서 넘어와 친 노트(비교 대상). 같은 이동만 반복되는 채보에서는
        # 이동 탓인지 그 패드 탓인지 가를 수 없어서 이동으로 보지 않는다. 비교 대상보다 확실히 더 놓칠 때만 이동 탓이다(설계 U14)
        contrast = [n for n in ordered if n.pad == dst and src not in _from_pads(n)]
        if len(contrast) < TRANSITION_MIN_CONTRAST:
            continue
        base = sum(n.judgement == "MISS" for n in contrast) / len(contrast)
        if share < TRANSITION_SHARE or rate < TRANSITION_RATE or rate < TRANSITION_LIFT * base:
            continue
        if best is None or share > best[0] or (share == best[0] and rate > best[1]):
            best = (share, rate, src, dst)
    return None if best is None else (best[0], best[2], best[3])


def _drift_late(ordered: Sequence[JudgedNote], good_ms: float, pad: str | None) -> float | None:
    starts = drifting = 0
    for i, n in enumerate(ordered):
        if n.judgement != "MISS" or (pad is not None and n.pad != pad):
            continue
        if i > 0 and ordered[i - 1].judgement == "MISS":
            continue
        starts += 1
        before = ordered[max(0, i - DRIFT_LOOKBACK) : i]
        if len(before) < DRIFT_LOOKBACK or not all(_is_valid(b) for b in before):
            continue
        ds = [float(b.delta_ms) for b in before]  # type: ignore[arg-type]
        if (
            all(d > 0 for d in ds)
            and ds[-1] >= DRIFT_LATE_COEF * good_ms
            and ds[-1] - ds[0] >= DRIFT_RISE_COEF * good_ms
        ):
            drifting += 1
    if starts == 0 or drifting == 0:
        return None
    share = drifting / starts
    return share if share >= DRIFT_SHARE else None


def miss_causes(
    notes: Sequence[JudgedNote],
    strays: Sequence[StrayHit],
    stage: int,
    note_gap_median_ms: float | None,
    pad: str | None = None,
    good_ms: float = BASIS_MS,
) -> list[CauseCandidate]:
    """단계에 맞는 놓침 원인 후보(FE `missCauses`). 근거가 없으면 빈 목록이다."""
    allowed = STAGE_CAUSES.get(stage, ())
    if not allowed:
        return []
    # 판정은 노트 순서와 다르게 들어오므로 노트 시각 순으로 본다(안정 정렬)
    ordered = sorted(notes, key=lambda n: n.note_time)
    misses = [n for n in ordered if n.judgement == "MISS" and (pad is None or n.pad == pad)]
    if len(misses) < CAUSE_MIN_MISSES:
        return []
    miss_pad = _most_common([m.pad for m in misses])

    out: list[CauseCandidate] = []
    if "WRONG_PAD" in allowed:
        w = _wrong_pad(misses, strays, good_ms)
        if w:
            out.append(CauseCandidate("WRONG_PAD", w[0], miss_pad, into_pad=w[1]))
    if "TRANSITION" in allowed:
        t = _transition(ordered, misses)
        if t:
            out.append(CauseCandidate("TRANSITION", t[0], t[2], from_pad=t[1]))
    if "DENSE" in allowed:
        d = _dense(misses, note_gap_median_ms)
        if d is not None:
            out.append(CauseCandidate("DENSE", d, miss_pad))
    if "DRIFT_LATE" in allowed:
        d = _drift_late(ordered, good_ms, pad)
        if d is not None:
            out.append(CauseCandidate("DRIFT_LATE", d, miss_pad))
    return out


def pick_cause_by_rule(candidates: Sequence[CauseCandidate]) -> CauseCandidate:
    """모델 없이 규칙 순서로 하나를 고른다. 후보가 없으면 UNKNOWN."""
    for cause in RULE_ORDER:
        c = next((x for x in candidates if x.cause == cause), None)
        if c is not None:
            return c
    return UNKNOWN_CAUSE


@dataclass(frozen=True)
class Firing:
    """규칙이 띄운 지적 한 건과 그때의 지표·단계·원인."""

    index: int
    key: str
    tag: str
    metrics: WindowMetrics
    stage: int = 0
    # 원인을 붙이지 않는 지적(놓침이 아니거나 1단계)이면 None
    cause: CauseCandidate | None = None
    candidates: tuple[CauseCandidate, ...] = ()


def replay(
    notes: Iterable[JudgedNote],
    strays: Iterable[StrayHit] = (),
    note_gap_median_ms: float | None = None,
) -> list[Firing]:
    """판정을 들어온 순서대로 넣는다. 채보 밖 타격은 곡 시각이 그 판정 이하인 것부터 먼저 넣는다."""
    window = JudgedWindow()
    policy = CorrectionPolicy()
    fired: list[Firing] = []
    pending = sorted(strays, key=lambda s: s.song_time_ms)
    si = 0
    median = (
        note_gap_median_ms
        if note_gap_median_ms is not None
        and math.isfinite(note_gap_median_ms)
        and note_gap_median_ms > 0
        else None
    )
    for i, note in enumerate(notes):
        if not math.isfinite(note.song_time_ms):
            continue
        while si < len(pending) and pending[si].song_time_ms <= note.song_time_ms:
            if math.isfinite(pending[si].song_time_ms):
                window.push_stray(pending[si])
            si += 1
        window.push(note)
        m = window.metrics()
        pick = policy.decide(evaluate_rules(m), note.song_time_ms, window.seen)
        if pick is None:
            continue
        stage = coach_stage(window.seen)
        cause = None
        candidates: list[CauseCandidate] = []
        if pick.tag in CAUSE_TAGS and stage >= CAUSE_MIN_STAGE:
            target = pick.key.split(":", 1)[1] if pick.tag == "LIVE_PAD_MISS" else None
            candidates = miss_causes(
                window.recent(CAUSE_WINDOW), window.stray_buf, stage, median, target
            )
            cause = pick_cause_by_rule(candidates)
        fired.append(Firing(i, pick.key, pick.tag, m, stage, cause, tuple(candidates)))
    return fired
