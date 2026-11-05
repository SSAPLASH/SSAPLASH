// 판정 → 스틱 진동 파형 번호 표 (PLAY-006). 곡 연주 중 FE가 판정한 즉시 그 손에 보낸다.
import type { Judgement } from '@/domain/judgement';

/**
 * 판정별 DRV2605 라이브러리 파형 번호.
 * 임시값: EMB 파형 번호 회신 대기(설계 U2). 회신이 오면 이 숫자만 바꾼다.
 */
export const HIT_WAVE = { PERFECT: 1, GOOD: 4 } as const;

/** 판정 → 파형 번호. MISS는 진동이 없다(null) */
export function waveForJudgement(j: Judgement): number | null {
  if (j === 'PERFECT') return HIT_WAVE.PERFECT;
  if (j === 'GOOD') return HIT_WAVE.GOOD;
  return null;
}
