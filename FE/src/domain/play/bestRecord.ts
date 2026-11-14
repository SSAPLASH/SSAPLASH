// 이 기기의 로컬 플레이 로그에서 최고 기록을 뽑는 순수 함수 (설계 U18).
// 곡 선택 표 = 곡별 최고 점수·정확도, 선택 곡 카드 = 연습 단계(채보)별 최고 점수(게임)·정확도(악보). 기록이 없으면 Map에 키가 없다.
// 로그는 끝까지 친 판만 저장된다(PlayPage·SheetPage의 finish에서만 savePlayLog) — 중간에 나간 판은 애초에 로그가 없어 따로 거르지 않는다.
import { DEFAULT_TIMING } from './judgement';
import type { PlayLog } from './playLog';

type LogMode = PlayLog['mode'];

/** 연습 속도(배율 1 미만)로 친 판인지. 최고 기록에는 원래 빠르기로 친 판만 센다(설계 MODE-003-practice-speed D9) */
export function isSlowedLog(l: Pick<PlayLog, 'playbackRate'>): boolean {
  return (l.playbackRate ?? 1) !== 1;
}

/** 곡별(BE 곡 id) 최고 점수. 모든 연습 단계 중 가장 높은 값. 내장 채보(곡 숫자 id 없음)는 건너뛴다 */
export function bestScoreBySong(logs: readonly PlayLog[], mode: LogMode): Map<number, number> {
  const best = new Map<number, number>();
  for (const l of logs) {
    if (l.mode !== mode || isSlowedLog(l) || l.songNumericId == null) continue;
    const score = l.summary.score;
    if (!Number.isFinite(score)) continue;
    const prev = best.get(l.songNumericId);
    if (prev === undefined || score > prev) best.set(l.songNumericId, score);
  }
  return best;
}

/** 채보(연습 단계)별 최고 정확도(0~1). 채보 id 없는 내장 채보·이전 로그는 건너뛴다 */
export function bestAccuracyByChart(logs: readonly PlayLog[], mode: LogMode): Map<number, number> {
  const best = new Map<number, number>();
  for (const l of logs) {
    if (l.mode !== mode || isSlowedLog(l) || l.chartId == null) continue;
    const acc = l.summary.accuracy;
    if (!Number.isFinite(acc)) continue;
    const prev = best.get(l.chartId);
    if (prev === undefined || acc > prev) best.set(l.chartId, acc);
  }
  return best;
}

/** 곡별(BE 곡 id) 최고 정확도(0~1). 모든 연습 단계 중 가장 높은 값. 곡 숫자 id 없는 내장 채보는 건너뛴다(악보 연습 곡 선택용) */
export function bestAccuracyBySong(logs: readonly PlayLog[], mode: LogMode): Map<number, number> {
  const best = new Map<number, number>();
  for (const l of logs) {
    if (l.mode !== mode || isSlowedLog(l) || l.songNumericId == null) continue;
    const acc = l.summary.accuracy;
    if (!Number.isFinite(acc)) continue;
    const prev = best.get(l.songNumericId);
    if (prev === undefined || acc > prev) best.set(l.songNumericId, acc);
  }
  return best;
}

// ── 결과 화면 최고 기록 비교(설계 MODE-001-score-combo-fx 3-4) ──

/** 채보(연습 단계)별 최고 점수. 채보 id가 있는 로그만 센다(게임 곡 선택 카드의 내장 개발 소스용, 결과 화면 비교 보조) */
export function bestScoreByChart(logs: readonly PlayLog[], mode: LogMode): Map<number, number> {
  const best = new Map<number, number>();
  for (const l of logs) {
    if (l.mode !== mode || isSlowedLog(l) || l.chartId == null) continue;
    const score = l.summary.score;
    if (!Number.isFinite(score)) continue;
    const prev = best.get(l.chartId);
    if (prev === undefined || score > prev) best.set(l.chartId, score);
  }
  return best;
}

/** 치기 전 최고값. 없으면 null */
export interface PrevBest {
  score: number | null;
  accuracy: number | null;
}

export const EMPTY_PREV_BEST: PrevBest = { score: null, accuracy: null };

/** 두 출처(로컬 로그·서버 스냅샷)의 최고값을 합친다. 둘 중 큰 값, 둘 다 없으면 null */
export function mergePrevBest(a: PrevBest, b: PrevBest): PrevBest {
  const max = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.max(x, y));
  return { score: max(a.score, b.score), accuracy: max(a.accuracy, b.accuracy) };
}

/**
 * 서버 스냅샷을 합칠지 정해 치기 전 최고값을 돌려준다. 기본 GOOD 폭(±60ms)으로 친 판만 서버 값을 합친다.
 * 서버 최고 기록 응답(`BestRecordDto`)에는 판정 폭이 없어 어느 폭으로 친 기록인지 가를 수 없으므로,
 * 넓힌 폭(예: 초보용 ±90ms)으로 친 판은 같은 폭의 로컬 로그만 쓴다.
 */
export function prevBestFor(local: PrevBest, server: PrevBest, goodMs: number): PrevBest {
  return goodMs === DEFAULT_TIMING.goodMs ? mergePrevBest(local, server) : local;
}

/** 로컬 로그에서 비교 대상을 찾는 기준(채보 식별 정보) */
export interface PrevBestTarget {
  mode: LogMode;
  songNumericId: number | null;
  chartId: number | null;
  /** 내장 채보(숫자 id 없음) 보조 매칭용 */
  songId: string;
  difficulty: string;
  /** 이 판에 적용한 GOOD 폭(ms). 주면 같은 폭으로 친 로그끼리만 비교한다. 없으면 폭을 따지지 않는다 */
  goodMs?: number;
}

/**
 * 로컬 로그에서 이 채보의 치기 전 최고값을 구한다. `exclude`로 방금 저장된 이 판을 뺀다.
 * 게임 점수는 곡별(숫자 id) → 채보별(채보 id) → 내장 곡(곡 id·단계) 순으로 대상을 고르고,
 * 악보 정확도는 채보별 → 내장 곡 순으로 고른다.
 */
export function localPrevBest(logs: readonly PlayLog[], target: PrevBestTarget, exclude?: (l: PlayLog) => boolean): PrevBest {
  let pool = exclude ? logs.filter((l) => !exclude(l)) : logs;
  // 옛 로그에는 timing이 없을 수 있어 옵셔널 체이닝으로 읽고, 없으면 대상에서 뺀다
  if (target.goodMs !== undefined) pool = pool.filter((l) => l.timing?.goodMs === target.goodMs);
  const builtin = (l: PlayLog) => l.mode === target.mode && !isSlowedLog(l) && l.songNumericId == null && l.chartId == null && l.songId === target.songId && l.difficulty === target.difficulty;
  const maxOf = (pick: (l: PlayLog) => number) => {
    let best: number | null = null;
    for (const l of pool) {
      if (!builtin(l)) continue;
      const v = pick(l);
      if (Number.isFinite(v) && (best === null || v > best)) best = v;
    }
    return best;
  };
  let score: number | null = null;
  if (target.songNumericId != null) score = bestScoreBySong(pool, target.mode).get(target.songNumericId) ?? null;
  else if (target.chartId != null) score = bestScoreByChart(pool, target.mode).get(target.chartId) ?? null;
  else score = maxOf((l) => l.summary.score);
  let accuracy: number | null = null;
  if (target.chartId != null) accuracy = bestAccuracyByChart(pool, target.mode).get(target.chartId) ?? null;
  else if (target.songNumericId == null) accuracy = maxOf((l) => l.summary.accuracy);
  return { score, accuracy };
}

export interface BestRecordDelta {
  /** first = 비교 대상이 없던 첫 기록 / new = 갱신 / same = 그 외(칩 없음) */
  kind: 'first' | 'new' | 'same';
  prevScore: number | null;
  prevAccuracy: number | null;
}

/** 정확도는 소수 3자리까지만 비교한다(0.9684 vs 0.9686 같은 부동소수 잡음 방지) */
const acc3 = (v: number) => Math.round(v * 1000);

/** 이 판과 치기 전 최고값을 비교한다. 게임은 점수, 악보는 정확도 기준 */
export function bestRecordDelta(log: Pick<PlayLog, 'mode' | 'summary'>, prev: PrevBest): BestRecordDelta {
  const base = { prevScore: prev.score, prevAccuracy: prev.accuracy };
  if (log.mode === 'SHEET') {
    if (prev.accuracy === null) return { kind: 'first', ...base };
    return { kind: acc3(log.summary.accuracy) > acc3(prev.accuracy) ? 'new' : 'same', ...base };
  }
  if (prev.score === null) return { kind: 'first', ...base };
  return { kind: log.summary.score > prev.score ? 'new' : 'same', ...base };
}

/** 결과 요약 카드 최고 기록 칩 글자. `same`이면 칩 없음(null) */
export function recordBadgeOf(log: Pick<PlayLog, 'mode' | 'summary'>, delta: BestRecordDelta): { kind: 'first' | 'new'; text: string } | null {
  if (delta.kind === 'same') return null;
  if (delta.kind === 'first') return { kind: 'first', text: '첫 기록' };
  if (log.mode === 'SHEET') {
    const prev = ((delta.prevAccuracy ?? 0) * 100).toFixed(1);
    return { kind: 'new', text: `최고 기록 갱신 · 이전 ${prev}% → 현재 ${(log.summary.accuracy * 100).toFixed(1)}%` };
  }
  return { kind: 'new', text: `최고 기록 갱신 · 이전 ${(delta.prevScore ?? 0).toLocaleString('ko-KR')} → 현재 ${log.summary.score.toLocaleString('ko-KR')}` };
}
