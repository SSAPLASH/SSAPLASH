import { describe, expect, it } from 'vitest';
import { popupLook } from './popupLook';

describe('popupLook(판정 팝업 시간 곡선)', () => {
  it('PERFECT: 1.3에서 시작해 90ms에 0.96, 210ms에 1', () => {
    expect(popupLook('PERFECT', 0, false).scale).toBeCloseTo(1.3);
    expect(popupLook('PERFECT', 90, false).scale).toBeCloseTo(0.96);
    expect(popupLook('PERFECT', 210, false).scale).toBeCloseTo(1);
  });
  it('PERFECT: 스탬프가 끝난 뒤 28px 올라가고 마지막 40%에서 페이드', () => {
    expect(popupLook('PERFECT', 100, false).rise).toBe(0);
    expect(popupLook('PERFECT', 600, false).rise).toBeCloseTo(28);
    expect(popupLook('PERFECT', 300, false).alpha).toBe(1);
    expect(popupLook('PERFECT', 480, false).alpha).toBeLessThan(1);
    expect(popupLook('PERFECT', 600, false).alpha).toBe(0);
  });
  it('GOOD: 1.1 → 1(120ms)', () => {
    expect(popupLook('GOOD', 0, false).scale).toBeCloseTo(1.1);
    expect(popupLook('GOOD', 120, false).scale).toBe(1);
  });
  it('MISS: 160ms 동안 ±3px 흔들리고 상승이 없으며 그 뒤 페이드', () => {
    const xs = Array.from({ length: 160 }, (_, t) => popupLook('MISS', t, false).dx);
    expect(Math.max(...xs)).toBeLessThanOrEqual(3);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-3);
    expect(Math.max(...xs)).toBeGreaterThan(2.5);
    expect(popupLook('MISS', 300, false).rise).toBe(0);
    expect(popupLook('MISS', 300, false).dx).toBe(0);
    expect(popupLook('MISS', 300, false).alpha).toBeLessThan(1);
  });
  it('모션 줄이기: 스케일·흔들림·상승 없이 페이드만', () => {
    for (const j of ['PERFECT', 'GOOD', 'MISS'] as const) {
      const l = popupLook(j, 100, true);
      expect([l.scale, l.dx, l.rise]).toEqual([1, 0, 0]);
    }
    expect(popupLook('PERFECT', 590, true).alpha).toBeLessThan(1);
  });
});
