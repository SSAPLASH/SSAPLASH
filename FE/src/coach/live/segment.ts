// 연주 중 LLM 구간 코칭의 마디 구간과 구간 사실(설계 COACH-001 연주 중 LLM 코칭 3.1·3.2).
// 구간은 1~4마디, 5~8마디, 9~16마디, 17~32마디, 이후 16마디씩이다. 마디 시각은 채보의 빠르기 변화(tempoSegments)를 따른다.
// 판정이 들어올 때마다 그 노트가 속한 구간에 모으고, 구간 끝 + 판정 폭이 지나면(놓침 판정까지 다 들어왔으면) 사실을 만든다.
// 사실에는 타격 원본·playId·곡 정보를 넣지 않는다. DOM·네트워크·시계를 쓰지 않는 순수 모듈이다.
// 스틱 입력이면 스틱 끝 방향 치우침(aim)도 넣는다(설계 COACH-001 각도·실측평가 3.1·3.2). 각도 숫자는 넣지 않고 방향·정도만 넣는다.
// 계산은 AI `coach_eval/live_segments.py`의 aim_facts와 같다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
import type { HandAnchors } from '@/domain/kit/calibration/calibration';
import type { Chart } from '@/domain/song/chart';
import type { Pose } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { barTimeMs, type TempoChart } from '@/domain/time/tempo';
import type { CoachStage } from './config';
import type { JudgedNote } from './window';

/** 구간 사실이 판정 이만큼 미만이면 요청하지 않는다(쉬는 마디 등) */
export const MIN_SEGMENT_JUDGED = 8;
/** 스틱 끝 방향(설계 3.2). 판정 반경 대비 치우침 비율. 가정값이라 실제 기록 분포로 다시 정한다(U2) */
export const AIM_SLIGHT = 0.3;
export const AIM_CLEAR = 0.6;
/** 패드마다 이만큼의 타격이 있어야 치우침을 말한다 */
export const AIM_MIN_HITS = 4;
/** 한 손이 이 비율 이상이면 그 손으로 본다 */
const AIM_HAND_SHARE = 0.75;
/** 구간마다 모아 두는 채보 밖 타격 상한 */
const MAX_STRAYS = 64;
const FIRST_SEGMENTS: readonly number[] = [4, 4, 8, 16];
const LATER_SEGMENT_BARS = 16;

export type SegmentChart = TempoChart & Pick<Chart, 'beatsPerBar'>;
export type InputKind = 'stick' | 'keyboard';

export interface SegmentRange {
  index: number;
  /** 1부터 센 마디 번호 */
  fromBar: number;
  toBar: number;
  startMs: number;
  endMs: number;
}

/** 구간 i의 마디 범위(0부터 센 시작 마디와 마디 수) */
export function segmentBars(index: number): { startBar: number; bars: number } {
  let start = 0;
  for (let i = 0; i < index; i++) start += i < FIRST_SEGMENTS.length ? FIRST_SEGMENTS[i] : LATER_SEGMENT_BARS;
  return { startBar: start, bars: index < FIRST_SEGMENTS.length ? FIRST_SEGMENTS[index] : LATER_SEGMENT_BARS };
}

export function segmentRange(chart: SegmentChart, index: number): SegmentRange {
  const { startBar, bars } = segmentBars(index);
  return {
    index,
    fromBar: startBar + 1,
    toBar: startBar + bars,
    startMs: barTimeMs(chart, startBar),
    endMs: barTimeMs(chart, startBar + bars),
  };
}

/** 노트 시각이 속한 구간 번호. 첫 마디 앞(인트로)이면 -1 */
export function segmentIndexAt(chart: SegmentChart, noteTimeMs: number): number {
  if (noteTimeMs < barTimeMs(chart, 0)) return -1;
  let i = 0;
  // 곡이 아무리 길어도 구간 수는 수백 개를 넘지 않는다
  while (i < 10_000 && noteTimeMs >= segmentRange(chart, i).endMs) i += 1;
  return i;
}

export interface LiveTipText {
  title: string;
  sub: string;
}

/** BE·워커에 보내는 구간 사실. AI `coach/live_narrative.py`의 LiveSegmentFacts와 같은 모양 */
export interface SegmentFacts {
  contractVersion: 1;
  segment: { index: number; fromBar: number; toBar: number };
  input: InputKind;
  counts: { perfect: number; good: number; miss: number };
  /** goodMs: 그 판의 판정 폭(GOOD, ms). 늦음·빠름의 정도(살짝·많이)를 이 폭 대비로 말한다 */
  timing: { meanDeltaMs: number | null; stdDeltaMs: number | null; sameSignRatio: number | null; goodMs: number };
  /** instead: 이 패드 칠 차례에 대신 가장 많이 친 패드(놓친 노트 근처의 채보 밖 타격). 없으면 null */
  pads: { pad: PadId; notes: number; misses: number; meanDeltaMs: number | null; instead: PadId | null }[];
  hands: { weakHand: 'LEFT' | 'RIGHT' | null; ratio: number | null };
  ruleCoach: { tags: string[]; causes: string[] };
  previous: { counts: { perfect: number; good: number; miss: number } | null; lastTip: LiveTipText | null };
  stage: CoachStage;
  /** 스틱 끝 방향 치우침(선택). 스틱 입력이고 근거가 있을 때만 넣는다. contractVersion은 1 그대로다 */
  aim?: AimFact[];
}

export interface AimFact {
  /** 쳐야 했던 패드(노트 패드) */
  pad: PadId;
  /** 근거 타격 수 */
  hits: number;
  /** 그중 다른 패드로 판정된 수 */
  wrongPad: number;
  vertical: 'HIGH' | 'LOW' | null;
  horizontal: 'LEFT' | 'RIGHT' | null;
  size: 'SLIGHT' | 'CLEAR';
  hand: 'LEFT' | 'RIGHT' | null;
}

/** 스틱 끝 방향 계산에 쓰는 기준: 손별 패드 기준 자세와 판정 반경(키트 판정과 같은 값) */
export interface AimSource {
  anchors: HandAnchors;
  /** 이 손의 방위각을 믿을 수 있는지(드리프트 보정 상태). 없으면 믿는다 */
  trustYaw?: (stickId: 0 | 1) => boolean;
}

/** 각도가 있는 스틱 타격 하나 */
export interface AimHit {
  notePad: PadId;
  stickId: 0 | 1;
  pose: Pose;
  wrongPad: boolean;
}

/** 채보 밖 타격(대신 친 패드·다른 패드로 잡힌 타격 후보). 손·방향은 센서 타격만 있다 */
interface StrayRecord {
  pad: PadId;
  songTimeMs: number;
  stickId: 0 | 1 | null;
  pose: Pose | null;
}

/** 끝난 구간 하나: 사실과, 다음 구간 길이(기한 계산용) */
export interface FinishedSegment {
  facts: SegmentFacts;
  range: SegmentRange;
  /** 다음 구간의 길이(ms). 응답 기한은 다음 구간 길이의 절반이다(설계 4.2) */
  nextDurationMs: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const isValid = (n: JudgedNote): n is JudgedNote & { deltaMs: number } =>
  (n.judgement === 'PERFECT' || n.judgement === 'GOOD') && n.deltaMs !== null && Number.isFinite(n.deltaMs);

interface Bucket {
  notes: JudgedNote[];
  tags: string[];
  causes: string[];
  aimHits: AimHit[];
  strays: StrayRecord[];
}

/**
 * 판정을 구간별로 모으고, 끝난 구간의 사실을 돌려준다. LiveCoach가 판정마다 부른다.
 * 노트가 없는 구간은 사실을 만들지 않는다(push가 오지 않는다).
 */
export class SegmentTracker {
  private readonly buckets = new Map<number, Bucket>();
  /** 사실을 이미 만든(또는 건너뛴) 구간의 다음 번호 */
  private nextToFinish = 0;
  private previousCounts: SegmentFacts['counts'] | null = null;
  private lastTip: LiveTipText | null = null;

  private readonly chart: SegmentChart;
  private readonly goodMs: number;
  private readonly input: InputKind;
  private readonly aim: AimSource | null;

  constructor(chart: SegmentChart, goodMs: number, input: InputKind, aim: AimSource | null = null) {
    this.chart = chart;
    this.goodMs = goodMs;
    this.input = input;
    this.aim = input === 'stick' ? aim : null;
  }

  /** 판정 한 건. 이 판정의 도착 시각(songTimeMs)으로 끝난 구간들의 사실을 돌려준다(보통 0개 또는 1개) */
  push(note: JudgedNote, stage: CoachStage): FinishedSegment[] {
    const i = segmentIndexAt(this.chart, note.noteTimeMs);
    if (i >= this.nextToFinish) {
      const b = this.bucket(i);
      b.notes.push(note);
      if (this.aim && note.judgement !== 'MISS' && note.pose && (note.stickId === 0 || note.stickId === 1)) {
        b.aimHits.push({ notePad: note.pad, stickId: note.stickId, pose: note.pose, wrongPad: false });
      }
    }
    return this.finishUntil(note.songTimeMs, stage);
  }

  /**
   * 채보 밖 타격. 같은 구간에서 놓친 노트 근처면 그 노트를 칠 차례에 대신 친 패드(instead)로 센다.
   * 센서 타격이고 방향이 있으면 스틱 끝 방향(aim)의 다른 패드로 잡힌 타격으로도 쓴다. 키보드 타격도 받는다
   */
  noteStray(pad: PadId, songTimeMs: number, stickId: 0 | 1 | null = null, pose: Pose | null = null): void {
    if (!Number.isFinite(songTimeMs)) return;
    const i = segmentIndexAt(this.chart, songTimeMs);
    if (i < this.nextToFinish) return;
    const b = this.bucket(i);
    const hand = stickId === 0 || stickId === 1 ? stickId : null;
    if (b.strays.length < MAX_STRAYS) b.strays.push({ pad, songTimeMs, stickId: hand, pose: hand === null ? null : pose });
  }

  /** 이 구간에 규칙이 띄운 지적과 고른 원인. 지적이 뜬 시각의 구간에 붙인다 */
  noteRuleCoach(songTimeMs: number, tag: string, cause: string | null): void {
    const i = segmentIndexAt(this.chart, songTimeMs);
    if (i < this.nextToFinish) return;
    const b = this.bucket(i);
    if (b.tags.length < 8 && !b.tags.includes(tag)) b.tags.push(tag);
    if (cause && cause !== 'UNKNOWN' && b.causes.length < 8 && !b.causes.includes(cause)) b.causes.push(cause);
  }

  /** 화면에 띄운 LLM 문구. 다음 구간 사실에 "직전에 한 말"로 넣어 반복을 막는다 */
  setLastTip(tip: LiveTipText): void {
    this.lastTip = tip;
  }

  reset(): void {
    this.buckets.clear();
    this.nextToFinish = 0;
    this.previousCounts = null;
    this.lastTip = null;
  }

  private bucket(i: number): Bucket {
    let b = this.buckets.get(i);
    if (!b) {
      b = { notes: [], tags: [], causes: [], aimHits: [], strays: [] };
      this.buckets.set(i, b);
    }
    return b;
  }

  private finishUntil(songTimeMs: number, stage: CoachStage): FinishedSegment[] {
    const out: FinishedSegment[] = [];
    // 놓침 판정은 판정 폭이 지난 뒤 온다. 구간 끝 + 판정 폭이 지나야 그 구간의 판정이 다 들어온다
    for (;;) {
      const range = segmentRange(this.chart, this.nextToFinish);
      if (songTimeMs < range.endMs + this.goodMs) break;
      const b = this.buckets.get(this.nextToFinish);
      this.buckets.delete(this.nextToFinish);
      this.nextToFinish += 1;
      if (!b || b.notes.length < MIN_SEGMENT_JUDGED) {
        if (b) this.previousCounts = countsOf(b.notes);
        continue;
      }
      const facts = this.factsOf(range, b, stage);
      this.previousCounts = facts.counts;
      const next = segmentRange(this.chart, this.nextToFinish);
      out.push({ facts, range, nextDurationMs: next.endMs - next.startMs });
      if (this.nextToFinish > 10_000) break;
    }
    return out;
  }

  private factsOf(range: SegmentRange, b: Bucket, stage: CoachStage): SegmentFacts {
    const valid = b.notes.filter(isValid);
    const deltas = valid.map((n) => n.deltaMs);
    const mean = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null;
    const std = mean === null ? null : Math.sqrt(deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length);
    const sign = mean === null ? 0 : Math.sign(mean);
    const same = mean === null || sign === 0 ? null : deltas.filter((d) => Math.sign(d) === sign).length / deltas.length;
    const aim = this.aim ? aimFacts([...b.aimHits, ...wrongPadHits(b, this.goodMs)], this.aim) : [];
    return {
      contractVersion: 1,
      segment: { index: range.index, fromBar: range.fromBar, toBar: range.toBar },
      input: this.input,
      counts: countsOf(b.notes),
      timing: {
        meanDeltaMs: mean === null ? null : round1(mean),
        stdDeltaMs: std === null ? null : round1(std),
        sameSignRatio: same === null ? null : round1(same * 100) / 100,
        goodMs: round1(this.goodMs),
      },
      pads: topPads(b.notes, insteadPads(b, this.goodMs)),
      hands: this.input === 'stick' ? weakHand(valid) : { weakHand: null, ratio: null },
      ruleCoach: { tags: [...b.tags], causes: [...b.causes] },
      previous: { counts: this.previousCounts, lastTip: this.lastTip },
      stage,
      ...(aim.length ? { aim } : {}),
    };
  }
}

/** 놓친 노트 ±goodMs 안에서 다른 패드로 잡힌 채보 밖 타격 → 그 노트 패드의 근거(wrongPad) */
/** 채보 밖 타격 s를 ±goodMs 안에서 가장 가까운 다른 패드 놓침에 붙인다. 없으면 null */
function missedNoteFor(missed: readonly JudgedNote[], s: StrayRecord, goodMs: number): JudgedNote | null {
  let best: JudgedNote | null = null;
  for (const n of missed) {
    if (n.pad === s.pad || Math.abs(s.songTimeMs - n.noteTimeMs) > goodMs) continue;
    if (!best || Math.abs(s.songTimeMs - n.noteTimeMs) < Math.abs(s.songTimeMs - best.noteTimeMs)) best = n;
  }
  return best;
}

/** 놓친 노트 ±goodMs 안에서 다른 패드로 잡힌 센서 타격 → 그 노트 패드의 근거(wrongPad) */
function wrongPadHits(b: Bucket, goodMs: number): AimHit[] {
  const missed = b.notes.filter((n) => n.judgement === 'MISS');
  const out: AimHit[] = [];
  for (const s of b.strays) {
    if (s.stickId === null || !s.pose) continue;
    const best = missedNoteFor(missed, s, goodMs);
    if (best) out.push({ notePad: best.pad, stickId: s.stickId, pose: s.pose, wrongPad: true });
  }
  return out;
}

/** 놓친 노트 패드마다 대신 가장 많이 친 패드. 같은 수면 먼저 나온 패드. AI `live_segments.instead_pads`와 같다 */
function insteadPads(b: Bucket, goodMs: number): Map<PadId, PadId> {
  const missed = b.notes.filter((n) => n.judgement === 'MISS');
  const counts = new Map<PadId, Map<PadId, number>>();
  for (const s of b.strays) {
    const best = missedNoteFor(missed, s, goodMs);
    if (!best) continue;
    const row = counts.get(best.pad) ?? new Map<PadId, number>();
    row.set(s.pad, (row.get(s.pad) ?? 0) + 1);
    counts.set(best.pad, row);
  }
  const out = new Map<PadId, PadId>();
  for (const [pad, row] of counts) {
    const top = Math.max(...row.values());
    for (const [hit, n] of row) {
      if (n === top) {
        out.set(pad, hit);
        break;
      }
    }
  }
  return out;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const wrap180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

/**
 * 패드마다 손별 기준 자세와의 고도각·방위각 차를 그 손의 판정 반경으로 나눈 값의 중앙값을 범주로 바꾼다(설계 3.2).
 * 기준이 없는 손·패드의 타격은 뺀다. 방위각은 믿을 수 있는 손의 타격만 본다. 최대 3개, 다른 패드로 잡힌 수가 많은 순
 */
export function aimFacts(hits: readonly AimHit[], source: AimSource): AimFact[] {
  const by = new Map<PadId, { v: number[]; h: number[]; sticks: (0 | 1)[]; wrong: number }>();
  for (const hit of hits) {
    const anchor = source.anchors[hit.stickId]?.[hit.notePad];
    if (!anchor || !(anchor.radius > 0)) continue;
    const row = by.get(hit.notePad) ?? { v: [], h: [], sticks: [], wrong: 0 };
    row.v.push((hit.pose.pitch - anchor.pitch) / anchor.radius);
    if (source.trustYaw?.(hit.stickId) ?? true) row.h.push(wrap180(hit.pose.yaw - anchor.yaw) / anchor.radius);
    row.sticks.push(hit.stickId);
    if (hit.wrongPad) row.wrong += 1;
    by.set(hit.notePad, row);
  }
  const rows: { wrong: number; biggest: number; fact: AimFact }[] = [];
  for (const [pad, r] of by) {
    if (r.v.length < AIM_MIN_HITS) continue;
    const dv = median(r.v);
    const dh = r.h.length >= AIM_MIN_HITS ? median(r.h) : 0;
    const vertical = Math.abs(dv) >= AIM_SLIGHT ? (dv > 0 ? 'HIGH' : 'LOW') : null;
    const horizontal = Math.abs(dh) >= AIM_SLIGHT ? (dh > 0 ? 'RIGHT' : 'LEFT') : null;
    if (!vertical && !horizontal) continue;
    const biggest = Math.max(vertical ? Math.abs(dv) : 0, horizontal ? Math.abs(dh) : 0);
    const left = r.sticks.filter((s) => s === 0).length / r.sticks.length;
    const hand = left >= AIM_HAND_SHARE ? 'LEFT' : 1 - left >= AIM_HAND_SHARE ? 'RIGHT' : null;
    rows.push({
      wrong: r.wrong,
      biggest,
      fact: { pad, hits: r.v.length, wrongPad: r.wrong, vertical, horizontal, size: biggest >= AIM_CLEAR ? 'CLEAR' : 'SLIGHT', hand },
    });
  }
  return rows
    .sort((a, b) => b.wrong - a.wrong || b.biggest - a.biggest)
    .slice(0, 3)
    .map((r) => r.fact);
}

function countsOf(notes: readonly JudgedNote[]): SegmentFacts['counts'] {
  const c = { perfect: 0, good: 0, miss: 0 };
  for (const n of notes) {
    if (n.judgement === 'PERFECT') c.perfect += 1;
    else if (n.judgement === 'GOOD') c.good += 1;
    else if (n.judgement === 'MISS') c.miss += 1;
  }
  return c;
}

/** 놓침이 많은 패드부터, 같으면 평균 오차가 큰 패드. 놓침도 큰 오차(15ms 이상)도 없는 패드는 넣지 않는다. 최대 3개 */
function topPads(notes: readonly JudgedNote[], instead: ReadonlyMap<PadId, PadId> = new Map()): SegmentFacts['pads'] {
  const by = new Map<PadId, JudgedNote[]>();
  for (const n of notes) by.set(n.pad, [...(by.get(n.pad) ?? []), n]);
  const rows = [...by.entries()].map(([pad, ns]) => {
    const ds = ns.filter(isValid).map((n) => n.deltaMs);
    const mean = ds.length ? round1(ds.reduce((s, d) => s + d, 0) / ds.length) : null;
    return { pad, notes: ns.length, misses: ns.filter((n) => n.judgement === 'MISS').length, meanDeltaMs: mean, instead: instead.get(pad) ?? null };
  });
  return rows
    .filter((r) => r.misses > 0 || (r.meanDeltaMs !== null && Math.abs(r.meanDeltaMs) >= 15))
    .sort((a, b) => b.misses - a.misses || Math.abs(b.meanDeltaMs ?? 0) - Math.abs(a.meanDeltaMs ?? 0))
    .slice(0, 3);
}

/** 손별 평균 세기의 비. 약한 손이 센 손의 80% 미만이면 약한 손으로 본다. 표본이 손마다 4개 미만이면 모른다 */
function weakHand(valid: readonly JudgedNote[]): SegmentFacts['hands'] {
  const sums = [0, 0];
  const counts = [0, 0];
  for (const n of valid) {
    if ((n.stickId !== 0 && n.stickId !== 1) || n.velocity === null || !Number.isFinite(n.velocity)) continue;
    sums[n.stickId] += n.velocity;
    counts[n.stickId] += 1;
  }
  if (counts[0] < 4 || counts[1] < 4) return { weakHand: null, ratio: null };
  const m = [sums[0] / counts[0], sums[1] / counts[1]];
  const high = Math.max(m[0], m[1]);
  if (!(high > 0)) return { weakHand: null, ratio: null };
  const ratio = Math.min(m[0], m[1]) / high;
  return { weakHand: ratio < 0.8 ? (m[0] < m[1] ? 'LEFT' : 'RIGHT') : null, ratio: Math.round(ratio * 100) / 100 };
}
