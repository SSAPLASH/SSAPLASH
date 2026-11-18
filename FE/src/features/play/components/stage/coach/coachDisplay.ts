// 코칭 문구를 언제·어떤 모양으로 띄울지 정한다(설계 COACH-001 D3). 시각만 다루는 순수 함수다.
// 문구 내용도 coach 모듈도 모른다. 바쁜 구간(노트가 몰린 곳)에서는 설명을 미루거나 구령만 띄운다.

/** 노트 수를 세는 구간 길이(ms): 문구가 뜨는 순간부터 이만큼 */
export const DENSE_WINDOW_MS = 1_000;
/** 이 개수 이상이면 바쁜 구간이다 */
export const DENSE_NOTE_COUNT = 4;
/** 바쁠 때 문구를 미루는 최대 시간(ms) */
export const MAX_DELAY_MS = 1_500;
/** 미룰 시간을 찾는 간격(ms) */
export const DELAY_STEP_MS = 100;

export type CoachDisplayMode = 'RHYTHM' | 'SHEET';

export interface CoachDisplayPlan {
  /** 문구를 띄우기 전에 기다릴 시간(ms) */
  delayMs: number;
  /** true면 보조 없이 구령(제목)만 띄운다 */
  compact: boolean;
}

/** 정렬된 배열에서 value 이상인 첫 위치 */
function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** [fromMs, fromMs + 1초) 안의 노트 수 */
function notesInWindow(sorted: readonly number[], fromMs: number): number {
  return lowerBound(sorted, fromMs + DENSE_WINDOW_MS) - lowerBound(sorted, fromMs);
}

/**
 * decidedMs: 문구가 결정된 곡 시각, noteTimesMs: 노트 시각(오름차순).
 * RHYTHM은 직후 1초 노트가 4개 이상이면 그 시점 1초 노트 수가 4 미만이 되는 가장 이른 지연(100ms 단위, 최대 1.5초)을 고른다.
 * 1.5초까지 찾지 못하면 1.5초 미루고 구령만 띄운다. SHEET는 미루지 않고 항상 설명까지 띄운다.
 */
export function planCoachDisplay(decidedMs: number, noteTimesMs: readonly number[], mode: CoachDisplayMode): CoachDisplayPlan {
  if (mode === 'SHEET') return { delayMs: 0, compact: false };
  for (let delay = 0; delay <= MAX_DELAY_MS; delay += DELAY_STEP_MS) {
    if (notesInWindow(noteTimesMs, decidedMs + delay) < DENSE_NOTE_COUNT) return { delayMs: delay, compact: false };
  }
  return { delayMs: MAX_DELAY_MS, compact: true };
}
