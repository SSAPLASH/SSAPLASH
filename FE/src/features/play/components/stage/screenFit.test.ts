import { describe, expect, it } from 'vitest';
import { PLAY_MIN_WIDTH_PX, SCREEN_FIT_QUERY, screenFits } from './screenFit';

describe('screenFits', () => {
  it('세로 화면은 거짓', () => {
    expect(screenFits(360, 800)).toBe(false);
  });
  it('폭 639 가로는 거짓, 640 가로는 참', () => {
    expect(screenFits(639, 400)).toBe(false);
    expect(screenFits(640, 400)).toBe(true);
  });
  it('정사각형은 참', () => {
    expect(screenFits(800, 800)).toBe(true);
  });
  it('폭이 640 미만인 정사각형은 거짓', () => {
    expect(screenFits(500, 500)).toBe(false);
  });
});

describe('SCREEN_FIT_QUERY', () => {
  it('최소 폭 상수에서 만들어진다', () => {
    expect(PLAY_MIN_WIDTH_PX).toBe(640);
    expect(SCREEN_FIT_QUERY).toContain(`(min-width: ${PLAY_MIN_WIDTH_PX}px)`);
    expect(SCREEN_FIT_QUERY).toBe('(min-aspect-ratio: 1/1) and (min-width: 640px)');
  });
});
