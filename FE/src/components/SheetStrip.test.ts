// SheetStrip 순수 좌표 계산 테스트 (시간 → x, 보이는 마디 범위, 마디 스냅)
import { describe, expect, it } from 'vitest';
import { snapToBar, visibleBars, xOfTime } from './sheetStripMath';

// 120 BPM 4/4: 마디 2000ms, 마디 폭 320px → 0.16px/ms
const BAR_MS = 2000;

describe('SheetStrip 좌표 계산', () => {
  it('x(t)는 기준선에서 시간 차 × pxPerMs만큼 떨어진다', () => {
    expect(xOfTime(1000, 1000, 800, 320, 0.35, BAR_MS)).toBe(280); // 기준선
    expect(xOfTime(3000, 1000, 800, 320, 0.35, BAR_MS)).toBeCloseTo(280 + 320);
    expect(xOfTime(0, 1000, 800, 320, 0.35, BAR_MS)).toBeCloseTo(280 - 160);
  });

  it('보이는 마디 범위는 화면 양끝 ±1마디이고 곡 범위로 잘린다', () => {
    // 곡 시각 0: 오른쪽 끝 = 520/0.16 = 3250ms → 마디 1 + 1
    expect(visibleBars(0, 800, 320, 0.35, BAR_MS, 100)).toEqual({ first: 0, last: 2 });
    // 곡 시각 20000(마디 10): 왼쪽 18250 → 9-1 = 8, 오른쪽 23250 → 11+1 = 12
    expect(visibleBars(20_000, 800, 320, 0.35, BAR_MS, 100)).toEqual({ first: 8, last: 12 });
    // 마지막 마디를 지나면 끝으로 잘린다
    expect(visibleBars(20_000, 800, 320, 0.35, BAR_MS, 10).last).toBe(9);
  });

  it('카운트인(음수 시각)과 reduced-motion 스냅', () => {
    expect(visibleBars(-2000, 800, 320, 0.35, BAR_MS, 4).first).toBe(0);
    expect(snapToBar(4500, BAR_MS)).toBe(4000);
    expect(snapToBar(-500, BAR_MS)).toBe(-2000);
  });
});
