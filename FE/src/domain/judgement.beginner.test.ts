import { describe, expect, it } from 'vitest';
import { appliedWindows, BEGINNER_GOOD_MS, DEFAULT_TIMING } from './judgement';

describe('appliedWindows (초보 판정 폭)', () => {
  it('초보 하한은 90ms', () => {
    expect(BEGINNER_GOOD_MS).toBe(90);
  });

  it('초보 대상이면 GOOD을 하한까지 넓히고 PERFECT는 그대로 둔다', () => {
    expect(appliedWindows(DEFAULT_TIMING, true)).toEqual({ perfectMs: 25, goodMs: 90 });
  });

  it('사용자 값이 하한보다 넓으면 그대로 둔다', () => {
    expect(appliedWindows({ perfectMs: 30, goodMs: 120 }, true)).toEqual({ perfectMs: 30, goodMs: 120 });
  });

  it('초보 대상이 아니면 설정 값 그대로(GOOD 60)', () => {
    expect(appliedWindows(DEFAULT_TIMING, false)).toEqual({ perfectMs: 25, goodMs: 60 });
  });

  it('원본 설정 객체를 바꾸지 않는다', () => {
    const base = { perfectMs: 25, goodMs: 60 };
    appliedWindows(base, true);
    expect(base).toEqual({ perfectMs: 25, goodMs: 60 });
  });
});
