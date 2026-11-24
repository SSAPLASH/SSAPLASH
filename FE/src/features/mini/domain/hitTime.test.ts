import { describe, expect, it } from 'vitest';
import { hitTime } from './hitTime';

describe('hitTime', () => {
  it('타격 시각이 더 이르면 타격 시각을 쓴다', () => {
    expect(hitTime({ tHit: 100, tRecv: 130 })).toBe(100);
  });

  it('두 시각이 같으면 그 값을 쓴다', () => {
    expect(hitTime({ tHit: 100, tRecv: 100 })).toBe(100);
  });

  it('타격 시각이 받은 시각보다 뒤로 계산됐으면 받은 시각을 쓴다', () => {
    expect(hitTime({ tHit: 150, tRecv: 130 })).toBe(130);
  });

  it('타격 시각이 NaN이면 받은 시각을 쓴다', () => {
    expect(hitTime({ tHit: Number.NaN, tRecv: 130 })).toBe(130);
  });

  it('타격 시각이 Infinity·-Infinity여도 받은 시각을 쓴다', () => {
    expect(hitTime({ tHit: Number.POSITIVE_INFINITY, tRecv: 130 })).toBe(130);
    expect(hitTime({ tHit: Number.NEGATIVE_INFINITY, tRecv: 130 })).toBe(130);
  });
});
