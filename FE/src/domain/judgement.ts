export type Judgement = 'PERFECT' | 'GOOD' | 'MISS';

export interface TimingWindows {
  /** ± ms */
  perfectMs: number;
  goodMs: number;
}

/** 공통 명세서 10장 가정치. 센서 정밀도 실측 후 확정 */
export const DEFAULT_TIMING: TimingWindows = { perfectMs: 25, goodMs: 60 };

export const JUDGEMENT_SCORE: Record<Judgement, number> = {
  PERFECT: 100,
  GOOD: 60,
  MISS: 0,
};

export function judgeDelta(deltaMs: number, w: TimingWindows): Judgement {
  const a = Math.abs(deltaMs);
  if (a <= w.perfectMs) return 'PERFECT';
  if (a <= w.goodMs) return 'GOOD';
  return 'MISS';
}
