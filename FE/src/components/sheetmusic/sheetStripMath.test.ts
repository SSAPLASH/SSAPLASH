// drawSheet 시간 → x 계산 테스트
import { describe, expect, it } from 'vitest';
import { BAR_LEAD_PX, xInBar, xInBarContinuous, xOfTime, xOfTimeInBar } from './sheetStripMath';

// 120 BPM 4/4: 마디 2000ms, 마디 폭 320px → 0.16px/ms
const BAR_MS = 2000;

describe('xOfTime', () => {
  it('x(t)는 기준선에서 시간 차 × pxPerMs만큼 떨어진다', () => {
    expect(xOfTime(1000, 1000, 800, 320, 0.35, BAR_MS)).toBe(280); // 기준선
    expect(xOfTime(3000, 1000, 800, 320, 0.35, BAR_MS)).toBeCloseTo(280 + 320);
    expect(xOfTime(0, 1000, 800, 320, 0.35, BAR_MS)).toBeCloseTo(280 - 160);
  });
});

// 머리 반폭: 기본 6, 엑스 4.5 + 선 두께 반 1, 동그라미 엑스 7.5 + 선 두께 반 0.75. 마디선 오른쪽 끝은 left + 0.75
const HALF_WIDTHS = [6, 5.5, 8.25];

describe('xInBar', () => {
  it('ratio 0은 마디선 + 여백, ratio 1은 다음 마디선이다', () => {
    expect(xInBar(100, 300, 0)).toBe(100 + BAR_LEAD_PX);
    expect(xInBar(100, 300, 1)).toBe(400);
  });
  it.each(HALF_WIDTHS)('첫 칸 머리(반폭 %s)의 왼쪽 끝이 마디선 오른쪽 끝보다 2px 이상 오른쪽이다', (half) => {
    expect(xInBar(100, 300, 0) - half).toBeGreaterThanOrEqual(100 + 0.75 + 2);
  });
  it.each([180, 225, 349, 450])('슬롯 폭 %spx에서 마지막 칸(15/16) 머리 오른쪽 끝이 다음 마디선을 넘지 않는다', (slotW) => {
    expect(xInBar(0, slotW, 15 / 16) + 8.25).toBeLessThanOrEqual(slotW);
  });
});

describe('xOfTimeInBar', () => {
  const ORIGIN = 500;
  const call = (t: number, songTime: number) => xOfTimeInBar(t, songTime, 800, 320, 0.35, BAR_MS, ORIGIN);
  // 마디 bar의 ratio 칸에 있는 노트 머리 x: 마디 왼쪽(xOfTime) + xInBar
  const headX = (bar: number, ratio: number, songTime: number) =>
    xInBar(xOfTime(ORIGIN + bar * BAR_MS, songTime, 800, 320, 0.35, BAR_MS), 320, ratio);

  it('같은 시각 노트 머리 x와 같다', () => {
    const songTime = ORIGIN + 3 * BAR_MS;
    expect(call(ORIGIN + 3 * BAR_MS + 500, songTime)).toBeCloseTo(headX(3, 0.25, songTime));
    expect(call(ORIGIN + 2 * BAR_MS, songTime)).toBeCloseTo(headX(2, 0, songTime));
  });
  it('음수 마디(격자 원점 앞)도 같다', () => {
    const songTime = ORIGIN;
    expect(call(ORIGIN - 500, songTime)).toBeCloseTo(headX(-1, 0.75, songTime));
    expect(call(ORIGIN - BAR_MS, songTime)).toBeCloseTo(headX(-1, 0, songTime));
  });
});


describe('연속 타격 위치', () => {
  it('마지막 칸과 다음 마디 첫 칸 사이에서 연속이며 음수 마디에도 같은 규칙을 쓴다', () => {
    const x = (t: number) => xOfTimeInBar(t, 0, 800, 320, 0, BAR_MS, 0, 16);
    for (const boundary of [0, BAR_MS, 4 * BAR_MS]) {
      expect(Math.abs(x(boundary + 0.001) - x(boundary - 0.001))).toBeLessThan(0.01);
      expect(x(boundary)).toBeCloseTo(xInBarContinuous(boundary / BAR_MS * 320, 320, 0, 16));
    }
    expect(x(BAR_MS - BAR_MS / 16)).toBeCloseTo(xInBarContinuous(0, 320, 15 / 16, 16));
  });
});
