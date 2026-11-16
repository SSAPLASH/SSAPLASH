"""저장된 연주 기록으로 연주 중 LLM 구간 사실을 다시 만든다(설계 COACH-001 각도·실측평가 2.1, 3.1~3.2, 4.4).

운영 작업(`live_coach_jobs`)은 5분 뒤 지워지고 구간 사실을 저장하지 않는다. 그래서 이미 쌓인 연주로 평가하려면
저장된 타격(`hits`)·채보·FE 코칭 기록(`live_coach_events`)으로 FE와 같은 사실을 다시 계산해야 한다.

- 구간 경계·사실 계산은 FE `coach/live/segment.ts`(`SegmentTracker`)를 그대로 옮겼다. 마디 시각은 FE
  `domain/time/tempo.ts`, BE 채보 → 채보 변환은 `domain/song/chartMapping.ts`와 같다. FE가 바뀌면 같이 고친다
  (`tests/coach_eval/test_live_segments.py`가 FE 시험 `liveLlm.test.ts`와 같은 사례를 본다).
- 규칙 지적·원인(`ruleCoach`)은 다시 계산하지 않고, 그 판 FE 코칭 기록에 남은 지적 행과 `LIVE_CAUSE`를 쓴다.
- `aim`(스틱 끝 방향 치우침)은 FE에 아직 없다. 저장된 각도(`pitch`·`yaw`)와 그 판 캘리브레이션 패드 기준 자세로
  설계 3.2절대로 계산한다. FE에 요청하기 전에 각도 사실이 문구를 낫게 하는지 먼저 보려는 것이다.

모델·네트워크·DB를 쓰지 않는 순수 모듈이다. 운영 서버와 워커는 가져다 쓰지 않는다.
"""

from __future__ import annotations

import json
import math
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

# FE `segment.ts`
MIN_SEGMENT_JUDGED = 8
FIRST_SEGMENTS = (4, 4, 8, 16)
LATER_SEGMENT_BARS = 16
MAX_SEGMENTS = 10_000
# FE `config.ts` stages: 판정 수 4·8·16에서 1·2·3단계
STAGES = (4, 8, 16)
# FE `domain/pads.ts` normalizePadId의 옛 이름
PAD_ALIASES = {"HI_TOM": "SMALL_TOM"}
PADS = {
    "CRASH",
    "HIHAT",
    "SNARE",
    "SMALL_TOM",
    "MID_TOM",
    "FLOOR_TOM",
    "RIDE",
    "KICK",
    "HIHAT_PEDAL",
}
# FE `rules.ts`의 지적 태그(칭찬 `LIVE_GOOD_*`와 LLM 문구는 구간 지적에 넣지 않는다)
RULE_TAGS = {
    "LIVE_SETUP_OFFSET",
    "LIVE_SETUP_PADS",
    "LIVE_PAD_MISS",
    "LIVE_MISS_STREAK",
    "LIVE_LATE",
    "LIVE_EARLY",
    "LIVE_PAD_LATE",
    "LIVE_PAD_EARLY",
    "LIVE_HAND_WEAK",
    "LIVE_UNSTEADY",
}
GATE_DROP_TAG = "LIVE_GATE_DROP"
CAUSE_TAG = "LIVE_CAUSE"
LLM_TAG = "LIVE_LLM"

# 각도 치우침(설계 3.2). 반경 대비 비율은 가정값이라 실제 기록 분포로 다시 정한다(U2)
AIM_SLIGHT = 0.3
AIM_CLEAR = 0.6
AIM_MIN_HITS = 4
# 한 손이 이 비율 이상이면 그 손으로 본다
AIM_HAND_SHARE = 0.75
# 펌웨어 보드 단독 캘리브레이션과 같은 반경: 가장 가까운 패드까지 각도 × 0.6, 15~35°(EMB README)
RADIUS_FACTOR = 0.6
RADIUS_MIN_DEG = 15.0
RADIUS_MAX_DEG = 35.0
STICK_LEFT = 0  # FE weakHand: stickId 0이 왼손


def js_round(x: float, digits: int = 0) -> float:
    """JS `Math.round(x * 10**d) / 10**d`. 파이썬 round(은행가 반올림)와 .5에서 다르다"""
    k = 10**digits
    return math.floor(x * k + 0.5) / k


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


# ---------- 채보 ----------


@dataclass(frozen=True)
class TempoSegment:
    beat: float
    startMs: float
    bpm: float


@dataclass(frozen=True)
class ChartNote:
    noteId: str
    timeMs: float
    pad: str


@dataclass(frozen=True)
class SegmentChart:
    bpm: float
    offsetMs: float
    beatsPerBar: int
    tempoSegments: tuple[TempoSegment, ...] = ()
    notes: Mapping[str, ChartNote] = field(default_factory=dict)


def normalize_pad(pad: str) -> str | None:
    p = PAD_ALIASES.get(pad, pad)
    return p if p in PADS else None


def tempo_segments_from(
    offset_ms: float, ppq: float | None, tempo_map: Sequence[Mapping[str, Any]] | None
) -> tuple[TempoSegment, ...]:
    """FE `tempoSegmentsFrom`. 만들 수 없으면 빈 튜플(고정 bpm)"""
    if not ppq or ppq <= 0 or not tempo_map or len(tempo_map) < 2 or tempo_map[0]["tick"] != 0:
        return ()
    out: list[TempoSegment] = []
    ms = float(offset_ms)
    for i, t in enumerate(tempo_map):
        if not (t["bpm"] > 0) or (i > 0 and t["tick"] <= tempo_map[i - 1]["tick"]):
            return ()
        if i > 0:
            ms += (t["tick"] - tempo_map[i - 1]["tick"]) * 60_000 / ppq / tempo_map[i - 1]["bpm"]
        out.append(TempoSegment(t["tick"] / ppq, ms, t["bpm"]))
    return tuple(out)


def chart_from_detail(detail: Mapping[str, Any]) -> SegmentChart:
    """BE 채보 응답(`GET /api/v1/chart-versions/{id}`, FE `ChartDetailDto`) → 구간 계산용 채보"""
    notes: dict[str, ChartNote] = {}
    for n in detail["notes"]:
        pad = normalize_pad(n["pad"])
        if pad is None:
            continue
        notes[n["noteId"]] = ChartNote(n["noteId"], float(n["timeMs"]), pad)
    timing = detail.get("timing") or {}
    return SegmentChart(
        bpm=float(detail["bpm"]),
        offsetMs=float(detail["offsetMs"]),
        beatsPerBar=int(detail["beatsPerBar"]),
        tempoSegments=tempo_segments_from(
            detail["offsetMs"], timing.get("ppq"), timing.get("tempoMap")
        ),
        notes=notes,
    )


def beat_time_ms(chart: SegmentChart, i: float) -> float:
    segs = chart.tempoSegments
    seg: TempoSegment | None = None
    if len(segs) > 1:
        for s in segs:
            if s.beat <= i:
                seg = s
            else:
                break
    if seg is None:
        return chart.offsetMs + i * 60_000 / chart.bpm
    return seg.startMs + (i - seg.beat) * 60_000 / seg.bpm


def bar_time_ms(chart: SegmentChart, b: int) -> float:
    return beat_time_ms(chart, b * chart.beatsPerBar)


@dataclass(frozen=True)
class SegmentRange:
    index: int
    fromBar: int
    toBar: int
    startMs: float
    endMs: float


def segment_bars(index: int) -> tuple[int, int]:
    """(0부터 센 시작 마디, 마디 수)"""
    start = sum(
        FIRST_SEGMENTS[i] if i < len(FIRST_SEGMENTS) else LATER_SEGMENT_BARS for i in range(index)
    )
    return start, FIRST_SEGMENTS[index] if index < len(FIRST_SEGMENTS) else LATER_SEGMENT_BARS


def segment_range(chart: SegmentChart, index: int) -> SegmentRange:
    start, bars = segment_bars(index)
    return SegmentRange(
        index, start + 1, start + bars, bar_time_ms(chart, start), bar_time_ms(chart, start + bars)
    )


def segment_index_at(chart: SegmentChart, note_time_ms: float) -> int:
    if note_time_ms < bar_time_ms(chart, 0):
        return -1
    i = 0
    while i < MAX_SEGMENTS and note_time_ms >= segment_range(chart, i).endMs:
        i += 1
    return i


# ---------- 판정 ----------


@dataclass(frozen=True)
class JudgedNote:
    """FE `JudgedNote`에서 구간 계산에 쓰는 것만. MISS는 deltaMs·stickId·velocity가 없다"""

    songTimeMs: float
    noteTimeMs: float
    judgement: Literal["PERFECT", "GOOD", "MISS"]
    deltaMs: float | None
    pad: str
    stickId: int | None
    velocity: float | None


def _valid(n: JudgedNote) -> bool:
    return n.judgement in ("PERFECT", "GOOD") and n.deltaMs is not None and math.isfinite(n.deltaMs)


def counts_of(notes: Iterable[JudgedNote]) -> dict[str, int]:
    c = {"perfect": 0, "good": 0, "miss": 0}
    for n in notes:
        c[n.judgement.lower()] += 1
    return c


def coach_stage(judged: int) -> int:
    first, second, third = STAGES
    return 3 if judged >= third else 2 if judged >= second else 1 if judged >= first else 0


def instead_pads(
    notes: Sequence[JudgedNote], strays: Sequence[tuple[str, float]], good_ms: float
) -> dict[str, str]:
    """놓친 노트 패드마다 대신 가장 많이 친 패드. 채보 밖 타격을 ±good_ms 안의 가장 가까운 다른 패드 놓침에 붙인다.
    같은 수면 먼저 나온 패드. FE `segment.ts`의 insteadPads와 같다"""
    missed = [n for n in notes if n.judgement == "MISS"]
    counts: dict[str, dict[str, int]] = {}
    for pad, t in strays:
        best: JudgedNote | None = None
        for n in missed:
            if n.pad == pad or abs(t - n.noteTimeMs) > good_ms:
                continue
            if best is None or abs(t - n.noteTimeMs) < abs(t - best.noteTimeMs):
                best = n
        if best is not None:
            row = counts.setdefault(best.pad, {})
            row[pad] = row.get(pad, 0) + 1
    out: dict[str, str] = {}
    for pad, row in counts.items():
        top = max(row.values())
        out[pad] = next(k for k, v in row.items() if v == top)
    return out


# 이 수 이상 노트가 있어야 그 패드를 이번 구간에 쳤다고 본다. FE `PLAYED_MIN_NOTES`와 같다
PLAYED_MIN_NOTES = 2


def played_pads(notes: Sequence[JudgedNote]) -> list[str]:
    """노트가 PLAYED_MIN_NOTES개 이상 있던 패드. 처음 나온 순서. FE `playedPads`와 같다"""
    count: dict[str, int] = {}
    for n in notes:
        count[n.pad] = count.get(n.pad, 0) + 1
    return [pad for pad, c in count.items() if c >= PLAYED_MIN_NOTES]


def top_pads(
    notes: Sequence[JudgedNote],
    strays: Sequence[tuple[str, float]] = (),
    good_ms: float = 0.0,
) -> list[dict[str, Any]]:
    instead = instead_pads(notes, strays, good_ms) if strays else {}
    by: dict[str, list[JudgedNote]] = {}
    for n in notes:
        by.setdefault(n.pad, []).append(n)
    rows = []
    for pad, ns in by.items():
        ds = [n.deltaMs for n in ns if _valid(n)]
        mean = js_round(sum(ds) / len(ds), 1) if ds else None  # type: ignore[arg-type]
        rows.append(
            {
                "pad": pad,
                "notes": len(ns),
                "misses": sum(n.judgement == "MISS" for n in ns),
                "meanDeltaMs": mean,
                "instead": instead.get(pad),
            }
        )
    rows = [
        r
        for r in rows
        if r["misses"] > 0 or (r["meanDeltaMs"] is not None and abs(r["meanDeltaMs"]) >= 15)
    ]
    rows.sort(key=lambda r: (-r["misses"], -abs(r["meanDeltaMs"] or 0)))
    return rows[:3]


def weak_hand(valid: Sequence[JudgedNote]) -> dict[str, Any]:
    sums = [0.0, 0.0]
    counts = [0, 0]
    for n in valid:
        if n.stickId not in (0, 1) or n.velocity is None or not math.isfinite(n.velocity):
            continue
        sums[n.stickId] += n.velocity
        counts[n.stickId] += 1
    if counts[0] < 4 or counts[1] < 4:
        return {"weakHand": None, "ratio": None}
    m = [sums[0] / counts[0], sums[1] / counts[1]]
    high = max(m)
    if not high > 0:
        return {"weakHand": None, "ratio": None}
    ratio = min(m) / high
    weak = ("LEFT" if m[0] < m[1] else "RIGHT") if ratio < 0.8 else None
    return {"weakHand": weak, "ratio": js_round(ratio, 2)}


# ---------- 스틱 끝 방향 ----------


@dataclass(frozen=True)
class AimHit:
    """각도가 있는 스틱 타격 하나. `notePad`는 쳐야 했던 패드, `wrongPad`는 다른 패드로 판정됐는지"""

    noteTimeMs: float
    notePad: str
    pitch: float
    yaw: float
    stickId: int | None
    wrongPad: bool


def _angle_between(a: Mapping[str, float], b: Mapping[str, float]) -> float:
    """두 방향(고도각·방위각, 도) 사이 각도(도). 펌웨어 패드 판정과 같은 기준"""

    def vec(p: Mapping[str, float]) -> tuple[float, float, float]:
        el, az = math.radians(p["pitch"]), math.radians(p["yaw"])
        return (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))

    va, vb = vec(a), vec(b)
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(va, vb, strict=True))))
    return math.degrees(math.acos(dot))


def pad_radius(pad: str, poses: Mapping[str, Mapping[str, float]]) -> float:
    others = [_angle_between(poses[pad], p) for k, p in poses.items() if k != pad]
    if not others:
        return RADIUS_MAX_DEG
    return min(RADIUS_MAX_DEG, max(RADIUS_MIN_DEG, min(others) * RADIUS_FACTOR))


def _wrap180(x: float) -> float:
    return (x + 180.0) % 360.0 - 180.0


def aim_facts(
    hits: Sequence[AimHit],
    poses: Mapping[str, Mapping[str, float]],
    *,
    trust_yaw: bool = True,
) -> list[dict[str, Any]]:
    """설계 3.2: 패드마다 기준 방향과의 고도각·방위각 차 중앙값을 반경 대비로 범주화한다. 최대 3개"""
    by: dict[str, list[AimHit]] = {}
    for h in hits:
        if h.notePad in poses:
            by.setdefault(h.notePad, []).append(h)
    rows: list[tuple[int, float, dict[str, Any]]] = []
    for pad, hs in by.items():
        if len(hs) < AIM_MIN_HITS:
            continue
        ref = poses[pad]
        radius = pad_radius(pad, poses)
        dv = statistics.median(h.pitch - ref["pitch"] for h in hs) / radius
        dh = statistics.median(_wrap180(h.yaw - ref["yaw"]) for h in hs) / radius
        vertical = ("HIGH" if dv > 0 else "LOW") if abs(dv) >= AIM_SLIGHT else None
        horizontal = (
            ("RIGHT" if dh > 0 else "LEFT") if trust_yaw and abs(dh) >= AIM_SLIGHT else None
        )
        if vertical is None and horizontal is None:
            continue
        biggest = max(abs(dv) if vertical else 0.0, abs(dh) if horizontal else 0.0)
        size = "CLEAR" if biggest >= AIM_CLEAR else "SLIGHT"
        sticks = [h.stickId for h in hs if h.stickId in (0, 1)]
        hand = None
        if sticks:
            left = sum(s == STICK_LEFT for s in sticks) / len(sticks)
            if left >= AIM_HAND_SHARE:
                hand = "LEFT"
            elif 1 - left >= AIM_HAND_SHARE:
                hand = "RIGHT"
        wrong = sum(h.wrongPad for h in hs)
        rows.append(
            (
                wrong,
                biggest,
                {
                    "pad": pad,
                    "hits": len(hs),
                    "wrongPad": wrong,
                    "vertical": vertical,
                    "horizontal": horizontal,
                    "size": size,
                    "hand": hand,
                },
            )
        )
    rows.sort(key=lambda r: (-r[0], -r[1]))
    return [r[2] for r in rows[:3]]


# ---------- 구간 추적 (FE SegmentTracker) ----------


@dataclass
class _Bucket:
    notes: list[JudgedNote] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    causes: list[str] = field(default_factory=list)
    aim_hits: list[AimHit] = field(default_factory=list)
    # 채보 밖 타격 (패드, 곡 시각). 대신 친 패드(instead)를 센다
    strays: list[tuple[str, float]] = field(default_factory=list)
    # FE에도 있는 구간인지(판정이나 지적이 들어옴). 각도 타격만 있는 구간은 FE에 없다
    seen: bool = False


@dataclass(frozen=True)
class FinishedSegment:
    facts: dict[str, Any]
    range: SegmentRange
    nextDurationMs: float


class SegmentTracker:
    """FE `SegmentTracker`와 같은 규칙. `poses`를 주면 사실에 `aim`을 넣는다(스틱 입력만)"""

    def __init__(
        self,
        chart: SegmentChart,
        good_ms: float,
        input_kind: Literal["stick", "keyboard"],
        poses: Mapping[str, Mapping[str, float]] | None = None,
        *,
        trust_yaw: bool = True,
    ) -> None:
        self.chart = chart
        self.good_ms = good_ms
        self.input = input_kind
        self.poses = poses if input_kind == "stick" else None
        self.trust_yaw = trust_yaw
        self._buckets: dict[int, _Bucket] = {}
        self._next = 0
        self._previous: dict[str, int] | None = None
        self._last_tip: dict[str, str] | None = None

    def _bucket(self, i: int) -> _Bucket:
        return self._buckets.setdefault(i, _Bucket())

    def push(self, note: JudgedNote, stage: int) -> list[FinishedSegment]:
        i = segment_index_at(self.chart, note.noteTimeMs)
        if i >= self._next:
            b = self._bucket(i)
            b.notes.append(note)
            b.seen = True
        return self._finish_until(note.songTimeMs, stage)

    def note_stray(self, pad: str, song_time_ms: float) -> None:
        """FE `noteStray`와 같다. 구간마다 64개까지"""
        i = segment_index_at(self.chart, song_time_ms)
        if i < self._next:
            return
        b = self._bucket(i)
        b.seen = True
        if len(b.strays) < 64:
            b.strays.append((pad, song_time_ms))

    def note_aim(self, hit: AimHit) -> None:
        i = segment_index_at(self.chart, hit.noteTimeMs)
        if i >= self._next:
            self._bucket(i).aim_hits.append(hit)

    def note_rule_coach(self, song_time_ms: float, tag: str, cause: str | None) -> None:
        i = segment_index_at(self.chart, song_time_ms)
        if i < self._next:
            return
        b = self._bucket(i)
        b.seen = True
        if len(b.tags) < 8 and tag not in b.tags:
            b.tags.append(tag)
        if cause and cause != "UNKNOWN" and len(b.causes) < 8 and cause not in b.causes:
            b.causes.append(cause)

    def set_last_tip(self, title: str, sub: str) -> None:
        self._last_tip = {"title": title, "sub": sub}

    def _finish_until(self, song_time_ms: float, stage: int) -> list[FinishedSegment]:
        out: list[FinishedSegment] = []
        while True:
            rng = segment_range(self.chart, self._next)
            if song_time_ms < rng.endMs + self.good_ms:
                break
            b = self._buckets.pop(self._next, None)
            if b is not None and not b.seen:
                b = None
            self._next += 1
            if b is None or len(b.notes) < MIN_SEGMENT_JUDGED:
                if b is not None:
                    self._previous = counts_of(b.notes)
                continue
            facts = self._facts_of(rng, b, stage)
            self._previous = facts["counts"]
            nxt = segment_range(self.chart, self._next)
            out.append(FinishedSegment(facts, rng, nxt.endMs - nxt.startMs))
            if self._next > MAX_SEGMENTS:
                break
        return out

    def _facts_of(self, rng: SegmentRange, b: _Bucket, stage: int) -> dict[str, Any]:
        valid = [n for n in b.notes if _valid(n)]
        deltas = [n.deltaMs for n in valid]
        mean = sum(deltas) / len(deltas) if deltas else None  # type: ignore[arg-type]
        std = (
            None if mean is None else math.sqrt(sum((d - mean) ** 2 for d in deltas) / len(deltas))  # type: ignore[operator]
        )
        sign = 0 if mean is None else _sign(mean)
        same = (
            None
            if mean is None or sign == 0
            else sum(_sign(d) == sign for d in deltas) / len(deltas)  # type: ignore[arg-type]
        )
        facts: dict[str, Any] = {
            "contractVersion": 1,
            "segment": {"index": rng.index, "fromBar": rng.fromBar, "toBar": rng.toBar},
            "input": self.input,
            "counts": counts_of(b.notes),
            "timing": {
                "meanDeltaMs": None if mean is None else js_round(mean, 1),
                "stdDeltaMs": None if std is None else js_round(std, 1),
                # FE: round1(same * 100) / 100
                "sameSignRatio": None if same is None else js_round(same * 100, 1) / 100,
                "goodMs": js_round(self.good_ms, 1),
            },
            "pads": top_pads(b.notes, b.strays, self.good_ms),
            "hands": weak_hand(valid)
            if self.input == "stick"
            else {"weakHand": None, "ratio": None},
            "ruleCoach": {"tags": list(b.tags), "causes": list(b.causes)},
            "previous": {"counts": self._previous, "lastTip": self._last_tip},
            "stage": stage,
            "playedPads": played_pads(b.notes),
        }
        if self.poses:
            aim = aim_facts(b.aim_hits, self.poses, trust_yaw=self.trust_yaw)
            if aim:
                facts["aim"] = aim
        return facts


# ---------- 한 판 다시 계산 ----------


@dataclass(frozen=True)
class PlayRecord:
    """한 판의 저장 기록(설계 3.4 `sessions.csv` 한 행 + 그 판 `hits.csv` 행들)"""

    session_key: str
    input_source: Literal["STICK", "KEYBOARD"]
    good_ms: float
    hits: Sequence[Mapping[str, Any]]
    events: Sequence[Mapping[str, Any]] = ()
    pad_poses: Mapping[str, Mapping[str, float]] = field(default_factory=dict)


def _judged_notes(chart: SegmentChart, play: PlayRecord) -> tuple[list[JudgedNote], list[AimHit]]:
    """판정 행 → FE 판정 순서(도착 시각순). MISS는 노트 시각 + GOOD 폭에 도착한다(FE 판정 엔진과 같음)"""
    judged: list[JudgedNote] = []
    matched_hit: dict[str, Mapping[str, Any]] = {}
    strays: list[Mapping[str, Any]] = []
    for h in play.hits:
        nid = h.get("matched_note_id")
        if h.get("judgement") is None:
            strays.append(h)
            continue
        note = chart.notes.get(nid) if nid else None
        if note is None:
            continue
        if h["judgement"] == "MISS":
            judged.append(
                JudgedNote(
                    note.timeMs + play.good_ms, note.timeMs, "MISS", None, note.pad, None, None
                )
            )
        else:
            matched_hit[nid] = h
            judged.append(
                JudgedNote(
                    float(h["t_ms"]),
                    note.timeMs,
                    h["judgement"],
                    None if h.get("delta_ms") is None else float(h["delta_ms"]),
                    note.pad,
                    h.get("stick_id"),
                    None if h.get("velocity") is None else float(h["velocity"]),
                )
            )
    judged.sort(key=lambda n: n.songTimeMs)

    aim: list[AimHit] = []
    if play.input_source == "STICK":
        for nid, h in matched_hit.items():
            if h.get("pitch") is not None and h.get("yaw") is not None:
                n = chart.notes[nid]
                aim.append(
                    AimHit(
                        n.timeMs,
                        n.pad,
                        float(h["pitch"]),
                        float(h["yaw"]),
                        h.get("stick_id"),
                        False,
                    )
                )
        # 놓친 노트 시각 ±GOOD 폭 안에서 다른 패드로 판정된 채보 밖 타격 = 그 노트를 치려다 다른 패드로 잡힌 것
        missed = sorted(
            (
                chart.notes[h["matched_note_id"]]
                for h in play.hits
                if h.get("judgement") == "MISS" and h.get("matched_note_id") in chart.notes
            ),
            key=lambda n: n.timeMs,
        )
        for s in strays:
            if s.get("pitch") is None or s.get("yaw") is None:
                continue
            t = float(s["t_ms"])
            near = [
                n
                for n in missed
                if abs(t - n.timeMs) <= play.good_ms and normalize_pad(s["pad"]) != n.pad
            ]
            if near:
                n = min(near, key=lambda n: abs(t - n.timeMs))
                aim.append(
                    AimHit(
                        n.timeMs, n.pad, float(s["pitch"]), float(s["yaw"]), s.get("stick_id"), True
                    )
                )
    return judged, aim


def _rule_events(events: Sequence[Mapping[str, Any]]) -> list[tuple[float, str, Any]]:
    """FE 코칭 기록 → (곡 시각, 종류, 값). 지적 행 바로 뒤의 같은 시각 LIVE_CAUSE가 그 지적의 원인이다"""
    out: list[tuple[float, str, Any]] = []
    rows = list(events)
    for i, e in enumerate(rows):
        tag, t = e.get("tag"), float(e.get("tMs") or 0)
        if tag in RULE_TAGS:
            cause = None
            nxt = rows[i + 1] if i + 1 < len(rows) else None
            if nxt and nxt.get("tag") == CAUSE_TAG and float(nxt.get("tMs") or 0) == t:
                cause = _json(nxt.get("text")).get("picked")
            out.append((t, "rule", (tag, cause)))
        elif tag == GATE_DROP_TAG:
            # 거름 모델이 뺀 지적도 FE는 구간 지적에 넣는다(거르기 전에 붙인다)
            dropped = _json(e.get("text")).get("tag")
            if dropped in RULE_TAGS:
                out.append((t, "rule", (dropped, None)))
        elif tag == LLM_TAG:
            r = _json(e.get("text"))
            if r.get("status") == "SHOWN" and r.get("title"):
                out.append((t, "tip", (r["title"], r.get("sub") or "")))
    return out


def _json(text: Any) -> dict[str, Any]:
    try:
        v = json.loads(text) if isinstance(text, str) else {}
    except json.JSONDecodeError:
        return {}
    return v if isinstance(v, dict) else {}


def poses_from_hits(hits: Sequence[AimHit]) -> dict[str, dict[str, float]]:
    """업로드에 캘리브레이션 기준 자세가 없을 때(FE가 `calibration.pads`를 null로 보낸다) 쓰는 대체 기준.

    그 판에서 맞게 친 타격(다른 패드로 잡힌 타격 제외)의 패드별 고도각·방위각 중앙값을 기준으로 본다. 그래서 이 기준의
    `aim`은 "그 사람이 평소 치는 자리에서 이 구간에 얼마나 벗어났나"이고, FE의 캘리브레이션 기준과는 다르다.
    맞게 친 타격이 `AIM_MIN_HITS`개 미만인 패드는 기준을 만들지 않는다.
    """
    by: dict[str, list[AimHit]] = {}
    for h in hits:
        if not h.wrongPad:
            by.setdefault(h.notePad, []).append(h)
    return {
        pad: {
            "pitch": statistics.median(h.pitch for h in hs),
            "yaw": statistics.median(h.yaw for h in hs),
        }
        for pad, hs in by.items()
        if len(hs) >= AIM_MIN_HITS
    }


def rebuild_segments(
    chart: SegmentChart, play: PlayRecord, *, with_aim: bool, trust_yaw: bool = True
) -> list[FinishedSegment]:
    """한 판을 FE 순서대로 다시 돌려 끝난 구간 사실을 만든다. 마지막 구간은 FE처럼 끝나지 않으면 만들지 않는다"""
    input_kind: Literal["stick", "keyboard"] = (
        "stick" if play.input_source == "STICK" else "keyboard"
    )
    judged, aim_hits = _judged_notes(chart, play)
    poses = (play.pad_poses or poses_from_hits(aim_hits)) if with_aim else None
    tracker = SegmentTracker(chart, play.good_ms, input_kind, poses, trust_yaw=trust_yaw)
    for h in aim_hits:
        tracker.note_aim(h)
    # 같은 시각이면 판정이 먼저다(FE push: 구간 마무리 → 지적 붙이기)
    timeline: list[tuple[float, int, str, Any]] = [(n.songTimeMs, 0, "note", n) for n in judged]
    timeline += [(t, 1, kind, v) for t, kind, v in _rule_events(play.events)]
    # 채보 밖 타격은 친 시각에 FE로 들어온다(pushStray)
    timeline += [
        (float(h["t_ms"]), 0, "stray", pad)
        for h in play.hits
        if h.get("judgement") is None and (pad := normalize_pad(h["pad"])) is not None
    ]
    timeline.sort(key=lambda x: (x[0], x[1]))
    out: list[FinishedSegment] = []
    seen = 0
    for t, _, kind, v in timeline:
        if kind == "note":
            seen += 1
            out.extend(tracker.push(v, coach_stage(seen)))
        elif kind == "stray":
            tracker.note_stray(v, t)
        elif kind == "rule":
            tag, cause = v
            tracker.note_rule_coach(t, tag, cause)
        else:
            title, sub = v
            tracker.set_last_tip(title, sub)
    return out
