import { describe, expect, it } from 'vitest';
import { HIT_WAVE, waveForJudgement } from './haptics';

describe('waveForJudgement', () => {
  it('PERFECT·GOOD는 표의 파형 번호, MISS는 null', () => {
    expect(waveForJudgement('PERFECT')).toBe(HIT_WAVE.PERFECT);
    expect(waveForJudgement('GOOD')).toBe(HIT_WAVE.GOOD);
    expect(waveForJudgement('MISS')).toBeNull();
  });

  it('파형 번호는 프로토콜 범위(1~123)다', () => {
    for (const w of Object.values(HIT_WAVE)) {
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(123);
    }
  });
});
