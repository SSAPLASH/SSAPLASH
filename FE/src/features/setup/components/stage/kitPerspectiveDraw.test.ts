// 드럼 배치 캔버스 층의 넘침 계산 검증.
import { describe, expect, it } from 'vitest';
import { canvasBleed } from './kitPerspectiveDraw';

describe('canvasBleed', () => {
  it('캔버스가 그림 영역보다 넓으면 한쪽 넘침 폭을 준다', () => {
    expect(canvasBleed(1072, 1040)).toBe(16);
  });

  it('소수 크기는 반올림한다', () => {
    expect(canvasBleed(1073, 1040.5)).toBe(16);
  });

  it('같은 크기면 0', () => {
    expect(canvasBleed(1040, 1040)).toBe(0);
  });

  it('재지 못했거나(0) 더 좁으면 0', () => {
    expect(canvasBleed(0, 1040)).toBe(0);
    expect(canvasBleed(1000, 1040)).toBe(0);
    expect(canvasBleed(Number.NaN, 1040)).toBe(0);
  });
});
