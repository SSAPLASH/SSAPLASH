// 콤보 연출 단계 판정(설계 MODE-001-score-combo-fx 3-1). 순수 함수 — 시간·애니메이션·DOM은 모른다.
import type { Judgement } from '@/domain/play/judgement';

/** 콤보 표시가 시작되는 최소 콤보 */
export const COMBO_SHOW = 2;
/** 이 배수마다 pulse */
export const COMBO_PULSE_EVERY = 10;
/** burst가 나오는 콤보(그 뒤로는 COMBO_BURST_EVERY의 배수마다) */
export const COMBO_BURST = [50, 100] as const;
/** 100 뒤 burst 간격 */
export const COMBO_BURST_EVERY = 50;
/** 이 콤보 이상에서 MISS가 나야 break 연출이 있다(미만은 조용히 숨김) */
export const COMBO_BREAK_MIN = 10;

export type ComboStage = 'none' | 'show' | 'pulse' | 'burst' | 'break' | 'hide';

/** 이 콤보 값이 burst인지: 50, 100, 150, 200… */
export function isComboBurst(n: number): boolean {
  if ((COMBO_BURST as readonly number[]).includes(n)) return true;
  const last = COMBO_BURST[COMBO_BURST.length - 1];
  return n > last && n % COMBO_BURST_EVERY === 0;
}

/**
 * 판정 한 번의 콤보 연출 단계 하나를 고른다.
 * `none`은 바뀐 것이 없을 때(같은 값 재호출). 콤보는 1씩만 오르므로 pulse와 burst는 겹치지 않는다(burst 우선).
 */
export function comboStage(prev: number, next: number, judgement: Judgement): ComboStage {
  if (judgement === 'MISS') return prev >= COMBO_BREAK_MIN ? 'break' : 'hide';
  if (next < COMBO_SHOW) return 'hide';
  if (isComboBurst(next)) return 'burst';
  if (next % COMBO_PULSE_EVERY === 0) return 'pulse';
  if (next === prev) return 'none';
  return 'show';
}
