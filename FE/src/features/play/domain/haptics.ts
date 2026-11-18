// 판정 → 스틱 진동 파형 번호 표 (PLAY-006). 곡 연주 중 FE가 판정한 즉시 그 손에 보낸다.
import type { Judgement } from '@/domain/play/judgement';

/**
 * 판정별 DRV2605 라이브러리 파형 번호.
 * EMB 제안값: PERFECT 14(Strong Buzz), GOOD 17(Strong Click 1). 스틱 로컬 진동 강·중과 같은 파형이다
 * (PLAY-006 진동-세기-변경 메일). 실기기 QA에서 바꿀 수 있고, 바꿀 때는 이 숫자만 고친다.
 */
export const HIT_WAVE = { PERFECT: 14, GOOD: 17 } as const;

/** 판정 → 파형 번호. MISS는 진동이 없다(null) */
export function waveForJudgement(j: Judgement): number | null {
  if (j === 'PERFECT') return HIT_WAVE.PERFECT;
  if (j === 'GOOD') return HIT_WAVE.GOOD;
  return null;
}
