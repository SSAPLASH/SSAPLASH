import { describe, expect, it } from 'vitest';
import { errorSide, formatError, meanAbsMs, signedErrorMs } from './timingError';

describe('signedErrorMs', () => {
  it('늦으면 양수, 빠르면 음수', () => {
    expect(signedErrorMs(1020, 1000)).toBe(20);
    expect(signedErrorMs(980, 1000)).toBe(-20);
  });

  it('정수로 반올림한다', () => {
    expect(signedErrorMs(1000.4, 1000)).toBe(0);
    expect(signedErrorMs(1034.6, 1000)).toBe(35);
    // Math.round는 .5를 위로 올린다(−34.5 → −34)
    expect(signedErrorMs(965.5, 1000)).toBe(-34);
  });

  it('아주 작은 음수 차이도 -0이 아니라 0이다', () => {
    const result = signedErrorMs(999.9, 1000);
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });
});

describe('errorSide', () => {
  it('부호로 빠름·늦음·정박을 가른다', () => {
    expect(errorSide(-1)).toBe('early');
    expect(errorSide(1)).toBe('late');
    expect(errorSide(0)).toBe('exact');
  });
});

describe('formatError', () => {
  it('빠름·늦음·정박 글을 만든다', () => {
    expect(formatError(-34)).toBe('34ms 빠름');
    expect(formatError(8)).toBe('8ms 늦음');
    expect(formatError(0)).toBe('정박');
  });
});

describe('meanAbsMs', () => {
  it('빈 목록이면 null', () => {
    expect(meanAbsMs([])).toBeNull();
  });

  it('절댓값의 평균', () => {
    expect(meanAbsMs([10, -20, 30])).toBe(20);
  });

  it('평균을 반올림한다', () => {
    expect(meanAbsMs([1, 2])).toBe(2);
  });

  it('값이 하나면 그 절댓값', () => {
    expect(meanAbsMs([-7])).toBe(7);
  });
});
