// drawSheet 시간 → x 계산 테스트
import { describe, expect, it } from 'vitest';
import { xOfTime } from './sheetStripMath';

// 120 BPM 4/4: 마디 2000ms, 마디 폭 320px → 0.16px/ms
const BAR_MS = 2000;

describe('xOfTime', () => {
  it('x(t)는 기준선에서 시간 차 × pxPerMs만큼 떨어진다', () => {
    expect(xOfTime(1000, 1000, 800, 320, 0.35, BAR_MS)).toBe(280); // 기준선
    expect(xOfTime(3000, 1000, 800, 320, 0.35, BAR_MS)).toBeCloseTo(280 + 320);
    expect(xOfTime(0, 1000, 800, 320, 0.35, BAR_MS)).toBeCloseTo(280 - 160);
  });
});
