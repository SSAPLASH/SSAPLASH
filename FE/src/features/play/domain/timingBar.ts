// 타이밍 오차 막대 상태(설계 3-5, D8) — 순수 함수. 그리기·시계는 모른다.
// 판정(PERFECT·GOOD)마다 눈금 하나를 쌓고, 시각에서 눈금 목록(위치 −1~1·투명도)과 최근 평균 위치를 계산한다.
// 판정 범위 밖 타격(MISS)은 막대 양옆 MISS 구간에 눈금으로 따로 낸다(설계 MODE-001-lead-in-bars D19). 평균에는 넣지 않는다.
import type { Judgement } from '@/domain/play/judgement';

/** 보관하는 눈금 최대 수 */
export const TIMING_BAR_MAX = 20;
/** 눈금이 옅어져 사라지는 시간(ms) */
export const TIMING_BAR_FADE_MS = 2000;
/** 평균을 내는 최근 타수 */
export const TIMING_BAR_AVG_COUNT = 10;

export interface TimingMark {
  /** 타격 − 노트 (ms). 빠름 음수, 늦음 양수 */
  deltaMs: number;
  judgement: Judgement;
  /** 쌓은 시각(ms, 호출자 시계) */
  at: number;
}

export interface TimingBarState {
  /** 오래된 순. 최대 TIMING_BAR_MAX */
  marks: readonly TimingMark[];
}

export interface TimingTick {
  /** 막대 위 위치 −1(가장 빠름)~1(가장 늦음). 창(goodMs) 밖은 끝에 붙는다 */
  pos: number;
  /** 1 → 0 (2초에 걸쳐) */
  alpha: number;
  judgement: Judgement;
}

/** 판정 범위 밖 타격 눈금. 막대 양옆 MISS 구간 안 위치 */
export interface TimingMiss {
  /** 부호 포함 위치. |pos| 1(막대 끝)~2(구간 바깥 끝). 음수 빠름·양수 늦음. 2·goodMs 밖은 ±2에 붙는다 */
  pos: number;
  alpha: number;
}

/** 범위 밖 타격(타격 − 가까운 노트 ms)을 알리는 구독. 반환값은 해제 함수 */
export type MissSource = (onMiss: (deltaMs: number) => void) => () => void;

export interface TimingBarView {
  ticks: TimingTick[];
  misses: TimingMiss[];
  /** 최근 10타 평균 위치. 눈금이 없으면 null(옅어진 눈금도 평균에는 들어간다) */
  avgPos: number | null;
}

export const EMPTY_TIMING_BAR: TimingBarState = { marks: [] };

const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));
/** MISS 구간 위치: |delta| goodMs→2·goodMs를 |pos| 1→2로 선형 배치(범위 밖은 끝에 붙임) */
const missPos = (deltaMs: number, w: number) => (deltaMs < 0 ? -1 : 1) * Math.min(2, Math.max(1, Math.abs(deltaMs) / w));

/** 판정을 눈금으로 더한다. PERFECT·GOOD만(MISS·deltaMs 없음은 무시). 20개를 넘으면 오래된 것부터 버린다 */
export function addTimingMark(state: TimingBarState, mark: { deltaMs: number | null; judgement: Judgement | null; at: number }): TimingBarState {
  if (mark.deltaMs === null || !Number.isFinite(mark.deltaMs)) return state;
  if (mark.judgement !== 'PERFECT' && mark.judgement !== 'GOOD') return state;
  const marks = [...state.marks, { deltaMs: mark.deltaMs, judgement: mark.judgement, at: mark.at }];
  return { marks: marks.length > TIMING_BAR_MAX ? marks.slice(marks.length - TIMING_BAR_MAX) : marks };
}

/** 범위 밖 타격을 MISS 마크로 더한다. deltaMs가 0이거나 숫자가 아니면 무시. 보관 수(20)는 눈금과 함께 센다 */
export function addMissMark(state: TimingBarState, mark: { deltaMs: number; at: number }): TimingBarState {
  if (!Number.isFinite(mark.deltaMs) || mark.deltaMs === 0) return state;
  const marks = [...state.marks, { deltaMs: mark.deltaMs, judgement: 'MISS' as const, at: mark.at }];
  return { marks: marks.length > TIMING_BAR_MAX ? marks.slice(marks.length - TIMING_BAR_MAX) : marks };
}

/** now 시점의 눈금 목록(옅어진 것은 뺀다)과 평균 위치. goodMs는 막대 바깥 창의 절반 폭(ms) */
export function timingBarView(state: TimingBarState, now: number, goodMs: number): TimingBarView {
  const w = goodMs > 0 ? goodMs : 1;
  const ticks: TimingTick[] = [];
  const misses: TimingMiss[] = [];
  for (const m of state.marks) {
    const alpha = 1 - (now - m.at) / TIMING_BAR_FADE_MS;
    if (alpha <= 0) continue;
    if (m.judgement === 'MISS') misses.push({ pos: missPos(m.deltaMs, w), alpha: Math.min(1, alpha) });
    else ticks.push({ pos: clamp1(m.deltaMs / w), alpha: Math.min(1, alpha), judgement: m.judgement });
  }
  // 평균은 판정 범위 안 경향이라 MISS는 빼고 최근 10타
  const recent = state.marks.filter((m) => m.judgement !== 'MISS').slice(-TIMING_BAR_AVG_COUNT);
  const avgPos = recent.length === 0 ? null : clamp1(recent.reduce((s, m) => s + m.deltaMs, 0) / recent.length / w);
  return { ticks, misses, avgPos };
}

/** 살아 있는(아직 옅어지지 않은) 눈금이 있는가 — rAF를 계속 돌릴지 정한다 */
export function hasLiveTicks(state: TimingBarState, now: number): boolean {
  const last = state.marks[state.marks.length - 1];
  return last !== undefined && now - last.at < TIMING_BAR_FADE_MS;
}
