import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatElapsed } from './formatTime';

describe('formatDuration', () => {
  it('m:ss 반올림', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(499)).toBe('0:00');
    expect(formatDuration(500)).toBe('0:01');
    expect(formatDuration(59_400)).toBe('0:59');
    expect(formatDuration(59_500)).toBe('1:00');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(135_000)).toBe('2:15');
  });
});

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [72_000, '1:12'],
    [204_500, '3:24'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_723_000, '1:02:03'],
    [-5, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

describe('formatElapsed', () => {
  it('mm:ss 내림, 음수는 0', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(-500)).toBe('00:00');
    expect(formatElapsed(999)).toBe('00:00');
    expect(formatElapsed(59_999)).toBe('00:59');
    expect(formatElapsed(60_000)).toBe('01:00');
    expect(formatElapsed(83_000)).toBe('01:23');
  });

  it('100분 이상이면 자리수가 늘어난다', () => {
    expect(formatElapsed((123 * 60 + 45) * 1000)).toBe('123:45');
  });
});
