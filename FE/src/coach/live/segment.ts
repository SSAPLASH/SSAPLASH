// 연주 중 LLM 구간 코칭의 마디 구간과 구간 사실(설계 COACH-001 연주 중 LLM 코칭 3.1·3.2).
// 구간은 1~4마디, 5~8마디, 9~16마디, 17~32마디, 이후 16마디씩이다. 마디 시각은 채보의 빠르기 변화(tempoSegments)를 따른다.
// 판정이 들어올 때마다 그 노트가 속한 구간에 모으고, 구간 끝 + 판정 폭이 지나면(놓침 판정까지 다 들어왔으면) 사실을 만든다.
// 사실에는 타격 원본·playId·곡 정보를 넣지 않는다. DOM·네트워크·시계를 쓰지 않는 순수 모듈이다.
import type { Chart } from '@/domain/chart';
import type { PadId } from '@/domain/pads';
import { barTimeMs, type TempoChart } from '@/domain/tempo';
import type { CoachStage } from './config';
import type { JudgedNote } from './window';

/** 구간 사실이 판정 이만큼 미만이면 요청하지 않는다(쉬는 마디 등) */
export const MIN_SEGMENT_JUDGED = 8;
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
  timing: { meanDeltaMs: number | null; stdDeltaMs: number | null; sameSignRatio: number | null };
  pads: { pad: PadId; notes: number; misses: number; meanDeltaMs: number | null }[];
  hands: { weakHand: 'LEFT' | 'RIGHT' | null; ratio: number | null };
  ruleCoach: { tags: string[]; causes: string[] };
  previous: { counts: { perfect: number; good: number; miss: number } | null; lastTip: LiveTipText | null };
  stage: CoachStage;
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

  constructor(chart: SegmentChart, goodMs: number, input: InputKind) {
    this.chart = chart;
    this.goodMs = goodMs;
    this.input = input;
  }

  /** 판정 한 건. 이 판정의 도착 시각(songTimeMs)으로 끝난 구간들의 사실을 돌려준다(보통 0개 또는 1개) */
  push(note: JudgedNote, stage: CoachStage): FinishedSegment[] {
    const i = segmentIndexAt(this.chart, note.noteTimeMs);
    if (i >= this.nextToFinish) this.bucket(i).notes.push(note);
    return this.finishUntil(note.songTimeMs, stage);
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
      b = { notes: [], tags: [], causes: [] };
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
    return {
      contractVersion: 1,
      segment: { index: range.index, fromBar: range.fromBar, toBar: range.toBar },
      input: this.input,
      counts: countsOf(b.notes),
      timing: { meanDeltaMs: mean === null ? null : round1(mean), stdDeltaMs: std === null ? null : round1(std), sameSignRatio: same === null ? null : round1(same * 100) / 100 },
      pads: topPads(b.notes),
      hands: this.input === 'stick' ? weakHand(valid) : { weakHand: null, ratio: null },
      ruleCoach: { tags: [...b.tags], causes: [...b.causes] },
      previous: { counts: this.previousCounts, lastTip: this.lastTip },
      stage,
    };
  }
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
function topPads(notes: readonly JudgedNote[]): SegmentFacts['pads'] {
  const by = new Map<PadId, JudgedNote[]>();
  for (const n of notes) by.set(n.pad, [...(by.get(n.pad) ?? []), n]);
  const rows = [...by.entries()].map(([pad, ns]) => {
    const ds = ns.filter(isValid).map((n) => n.deltaMs);
    const mean = ds.length ? round1(ds.reduce((s, d) => s + d, 0) / ds.length) : null;
    return { pad, notes: ns.length, misses: ns.filter((n) => n.judgement === 'MISS').length, meanDeltaMs: mean };
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
