import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, COUNTDOWN_STEP_MS, countdownValue } from './leadIn';

describe('countdownValue(gridMs, leadBarMs)', () => {
  it('상수', () => {
    expect(COUNTDOWN_MS).toBe(3000);
    expect(COUNTDOWN_STEP_MS).toBe(1000);
  });

  it('준비 마디 2667ms: 준비 마디 시작(격자 −2667)까지 3·2·1', () => {
    expect(countdownValue(-5667, 2667)).toBe(3);
    expect(countdownValue(-4667.1, 2667)).toBe(3);
    expect(countdownValue(-4667, 2667)).toBe(2);
    expect(countdownValue(-3667, 2667)).toBe(1);
    expect(countdownValue(-2667 - 0.1, 2667)).toBe(1);
  });

  it('준비 마디 시작 이후(불 켜짐)는 null', () => {
    expect(countdownValue(-2667, 2667)).toBeNull();
    expect(countdownValue(-1, 2667)).toBeNull();
    expect(countdownValue(0, 2667)).toBeNull();
    expect(countdownValue(100, 2667)).toBeNull();
  });

  it('준비 마디 없음(leadBar 0)은 항상 null', () => {
    expect(countdownValue(-7667, 0)).toBeNull();
    expect(countdownValue(-0.1, 0)).toBeNull();
  });

  it('카운트다운보다 앞(BEGIN_LEAD 등)이어도 3을 넘지 않는다', () => {
    expect(countdownValue(-6667, 2667)).toBe(3);
    expect(countdownValue(-9000, 2667)).toBe(3);
    expect(countdownValue(-60000, 2667)).toBe(3);
  });

  it('준비 마디 길이가 달라도 숫자 간격은 1초', () => {
    expect(countdownValue(-5000, 2000)).toBe(3);
    expect(countdownValue(-4000, 2000)).toBe(2);
    expect(countdownValue(-3000, 2000)).toBe(1);
    expect(countdownValue(-2000, 2000)).toBeNull();
  });
});
