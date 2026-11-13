// 놓침 원인 후보를 규칙으로 계산한다(설계 3.1). 문구는 정하지 않는다(copy).
// 판정은 노트 순서와 다르게 들어오므로(MISS는 판정 폭이 지난 뒤 온다) 창 안 기록을 노트 시각 순으로 정렬해서 본다.
// 상태를 갖지 않는 순수 함수다.
import { STICK_PADS, type PadId } from '@/domain/kit/pads';
import { LIVE_COACH_CONFIG, type CoachStage } from './config';
import type { JudgedNote, StrayHit } from './window';

/** ONE_HAND는 제외했다(C1: 놓친 노트의 손 차례를 알 수 없다) */
export type MissCause = 'TRANSITION' | 'DENSE' | 'WRONG_PAD' | 'DRIFT_LATE' | 'UNKNOWN';

export interface CauseCandidate {
  cause: MissCause;
  /** 0~1. 그 원인으로 설명되는 놓침의 비율 */
  strength: number;
  /** 놓친 노트의 패드. 놓침이 여러 패드면 가장 많이 놓친 패드 */
  pad: PadId | null;
  /** TRANSITION: 어느 패드에서 넘어오다 놓쳤나 */
  fromPad?: PadId;
  /** WRONG_PAD: 대신 친 패드 */
  intoPad?: PadId;
}

export interface CauseInput {
  /** 최근 판정(들어온 순서여도 된다) */
  notes: readonly JudgedNote[];
  strays: readonly StrayHit[];
  stage: CoachStage;
  goodMs: number;
  /** 곡의 노트 간격 중앙값. 없으면 DENSE를 계산하지 않는다 */
  noteGapMedianMs: number | null;
  /** 지적 대상 패드(패드 놓침 규칙). 있으면 그 패드의 놓침만 본다 */
  pad?: PadId | null;
}

/** 단계별로 말할 수 있는 원인. 2단계는 근거가 분명한 것만 */
const STAGE_CAUSES: Record<CoachStage, readonly MissCause[]> = {
  0: [],
  1: [],
  2: ['WRONG_PAD', 'DENSE'],
  3: ['WRONG_PAD', 'TRANSITION', 'DENSE', 'DRIFT_LATE'],
};

/** 모델이 없을 때 고르는 순서. 구체적으로 고칠 수 있는 원인을 먼저 */
export const RULE_ORDER: readonly MissCause[] = ['WRONG_PAD', 'TRANSITION', 'DENSE', 'DRIFT_LATE'];

export const UNKNOWN_CAUSE: CauseCandidate = { cause: 'UNKNOWN', strength: 0, pad: null };

const isMiss = (n: JudgedNote): boolean => n.judgement === 'MISS';
const isValid = (n: JudgedNote): n is JudgedNote & { deltaMs: number } =>
  (n.judgement === 'PERFECT' || n.judgement === 'GOOD') && n.deltaMs !== null && Number.isFinite(n.deltaMs);

function mostCommon<T>(xs: readonly T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  let best: { value: T; count: number } | null = null;
  for (const x of xs) {
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (!best || c > best.count) best = { value: x, count: c };
  }
  return best;
}

function dense(misses: readonly JudgedNote[], median: number | null): number | null {
  if (median === null || !(median > 0)) return null;
  const c = LIVE_COACH_CONFIG.cause.dense;
  const known = misses.filter((m) => m.prevGapMs !== undefined && m.prevGapMs !== null);
  if (known.length < LIVE_COACH_CONFIG.cause.minMisses) return null;
  const hits = known.filter((m) => (m.prevGapMs as number) <= c.gapRatio * median).length;
  const share = hits / known.length;
  return hits >= LIVE_COACH_CONFIG.cause.minMisses && share >= c.share ? share : null;
}

function wrongPad(misses: readonly JudgedNote[], strays: readonly StrayHit[], goodMs: number): { share: number; intoPad: PadId } | null {
  const c = LIVE_COACH_CONFIG.cause.wrongPad;
  const near = c.nearCoef * goodMs;
  const into: PadId[] = [];
  for (const m of misses) {
    const s = strays.filter((x) => x.pad !== m.pad && Math.abs(x.songTimeMs - m.noteTimeMs) <= near);
    if (s.length === 0) continue;
    // 가장 가까운 타격을 그 놓침 대신 친 것으로 본다
    s.sort((a, b) => Math.abs(a.songTimeMs - m.noteTimeMs) - Math.abs(b.songTimeMs - m.noteTimeMs));
    into.push(s[0].pad);
  }
  const share = into.length / misses.length;
  const top = mostCommon(into);
  return top && into.length >= LIVE_COACH_CONFIG.cause.minMisses && share >= c.share ? { share, intoPad: top.value } : null;
}

/** 손으로 옮겨 가는 이동만 본다. 킥 같은 페달에서 넘어오는 것은 손 이동이 아니다 */
function fromPads(n: JudgedNote): PadId[] {
  return (n.prevPads ?? []).filter((p) => p !== n.pad && STICK_PADS.includes(p));
}

function transition(sorted: readonly JudgedNote[], misses: readonly JudgedNote[]): { share: number; fromPad: PadId; pad: PadId } | null {
  const c = LIVE_COACH_CONFIG.cause.transition;
  const moves: string[] = [];
  for (const m of misses) for (const f of fromPads(m)) moves.push(`${f}>${m.pad}`);
  const counts = new Map<string, number>();
  for (const k of moves) counts.set(k, (counts.get(k) ?? 0) + 1);
  // 같은 횟수면 그 이동 노트 중 놓친 비율이 높은 쪽
  let best: { share: number; rate: number; fromPad: PadId; pad: PadId } | null = null;
  for (const [k, count] of counts) {
    if (count < c.minRepeat) continue;
    const [from, to] = k.split('>') as [PadId, PadId];
    const total = sorted.filter((n) => n.pad === to && fromPads(n).includes(from)).length;
    const rate = total === 0 ? 0 : count / total;
    const share = count / misses.length;
    // 같은 패드를 다른 곳에서 넘어와 친 노트보다 확실히 더 놓칠 때만 이동 탓이다(설계 U14)
    const contrast = sorted.filter((n) => n.pad === to && !fromPads(n).includes(from));
    if (contrast.length < c.minContrast) continue;
    const base = contrast.filter(isMiss).length / contrast.length;
    if (share < c.share || rate < c.rate || rate < c.lift * base) continue;
    if (!best || share > best.share || (share === best.share && rate > best.rate)) best = { share, rate, fromPad: from, pad: to };
  }
  return best && { share: best.share, fromPad: best.fromPad, pad: best.pad };
}

/** pad가 있으면 그 패드의 놓침 묶음만 센다. 직전 타격은 패드와 무관하게 본다(박이 밀리는 것은 전체 흐름이다) */
function driftLate(sorted: readonly JudgedNote[], goodMs: number, pad: PadId | null): number | null {
  const c = LIVE_COACH_CONFIG.cause.drift;
  let starts = 0;
  let drifting = 0;
  sorted.forEach((n, i) => {
    if (!isMiss(n) || (pad !== null && n.pad !== pad) || (i > 0 && isMiss(sorted[i - 1]))) return;
    starts += 1;
    const before = sorted.slice(Math.max(0, i - c.lookback), i);
    if (before.length < c.lookback || !before.every(isValid)) return;
    const ds = before.map((b) => b.deltaMs as number);
    const last = ds[ds.length - 1];
    if (ds.every((d) => d > 0) && last >= c.lateCoef * goodMs && last - ds[0] >= c.riseCoef * goodMs) drifting += 1;
  });
  if (starts === 0 || drifting === 0) return null;
  const share = drifting / starts;
  return share >= c.share ? share : null;
}

/** 단계에 맞는 원인 후보. 근거가 없으면 빈 배열이다(그때 고른 원인은 UNKNOWN) */
export function missCauses(input: CauseInput): CauseCandidate[] {
  const allowed = STAGE_CAUSES[input.stage];
  if (allowed.length === 0) return [];
  const sorted = [...input.notes].sort((a, b) => a.noteTimeMs - b.noteTimeMs);
  const misses = sorted.filter((n) => isMiss(n) && (input.pad == null || n.pad === input.pad));
  if (misses.length < LIVE_COACH_CONFIG.cause.minMisses) return [];
  const missPad = mostCommon(misses.map((m) => m.pad))?.value ?? null;

  const out: CauseCandidate[] = [];
  if (allowed.includes('WRONG_PAD')) {
    const w = wrongPad(misses, input.strays, input.goodMs);
    if (w) out.push({ cause: 'WRONG_PAD', strength: w.share, pad: missPad, intoPad: w.intoPad });
  }
  if (allowed.includes('TRANSITION')) {
    const t = transition(sorted, misses);
    if (t) out.push({ cause: 'TRANSITION', strength: t.share, pad: t.pad, fromPad: t.fromPad });
  }
  if (allowed.includes('DENSE')) {
    const d = dense(misses, input.noteGapMedianMs);
    if (d !== null) out.push({ cause: 'DENSE', strength: d, pad: missPad });
  }
  if (allowed.includes('DRIFT_LATE')) {
    const d = driftLate(sorted, input.goodMs, input.pad ?? null);
    if (d !== null) out.push({ cause: 'DRIFT_LATE', strength: d, pad: missPad });
  }
  return out;
}

/** 모델이 없을 때 규칙 순서로 하나를 고른다. 후보가 없으면 UNKNOWN */
export function pickCauseByRule(candidates: readonly CauseCandidate[]): CauseCandidate {
  for (const cause of RULE_ORDER) {
    const c = candidates.find((x) => x.cause === cause);
    if (c) return c;
  }
  return UNKNOWN_CAUSE;
}
