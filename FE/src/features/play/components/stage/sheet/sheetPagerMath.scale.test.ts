// 악보 배율(staffScale) 단위 테스트: 칸 높이에 비례하되 1.2~1.6배로 자른다
import { describe, expect, it } from 'vitest';
import { CONTENT_BOTTOM, CONTENT_TOP, STAFF_SCALE_MAX, STAFF_SCALE_MIN, staffScale } from './sheetPagerMath';

const SPAN = CONTENT_BOTTOM - CONTENT_TOP;

describe('staffScale', () => {
  it('상수는 1.2~1.6배', () => {
    expect(STAFF_SCALE_MIN).toBe(1.2);
    expect(STAFF_SCALE_MAX).toBe(1.6);
  });
  it('칸이 충분히 높으면 최대 1.6배', () => {
    expect(staffScale(420)).toBe(STAFF_SCALE_MAX);
    expect(staffScale(SPAN * 1.6)).toBeCloseTo(1.6);
  });
  it('중간 높이는 칸 높이에 비례한다', () => {
    expect(staffScale(SPAN * 1.4)).toBeCloseTo(1.4);
  });
  it('칸이 더 낮아도 최소 1.2배가 이긴다', () => {
    expect(staffScale(SPAN * 1.2)).toBeCloseTo(1.2);
    expect(staffScale(100)).toBe(STAFF_SCALE_MIN);
    expect(staffScale(0)).toBe(STAFF_SCALE_MIN);
  });
});
