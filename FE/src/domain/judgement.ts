export type Judgement = 'PERFECT' | 'GOOD' | 'MISS';

export interface TimingWindows {
  /** ± ms */
  perfectMs: number;
  goodMs: number;
}

/** 공통 명세서 10장 가정치. 센서 정밀도 실측 후 확정 */
export const DEFAULT_TIMING: TimingWindows = { perfectMs: 25, goodMs: 60 };

/**
 * 코칭·피드백 임계값 계산에 쓰는 고정 기준 폭(ms). 현재 기본 goodMs와 같다.
 * 판정 폭과 분리한 이유: 판정 폭은 게임 난이도이고 코칭은 실제 박에서 벗어난 정도다
 * (AI 제안, MODE-001 설계 D2). 판정 폭을 바꿔도 코칭 강도가 따라 움직이지 않게 한다.
 */
export const COACH_REF_GOOD_MS = 60;

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
