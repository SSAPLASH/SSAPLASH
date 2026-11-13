import { describe, expect, it } from 'vitest';
import { appliedWindows, BEGINNER_GOOD_MS, DEFAULT_TIMING, wideGoodMs } from './judgement';

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

describe('wideGoodMs (넓혀 연주한 판의 GOOD 폭)', () => {
  it('기본 폭보다 넓을 때만 그 값을 돌려준다', () => {
    expect(wideGoodMs({ goodMs: 60 })).toBeNull();
    expect(wideGoodMs({ goodMs: 61 })).toBe(61);
    expect(wideGoodMs({ goodMs: 90 })).toBe(90);
  });

  it('값이 없거나 유한하지 않으면 null', () => {
    expect(wideGoodMs(undefined)).toBeNull();
    expect(wideGoodMs(null)).toBeNull();
    expect(wideGoodMs({ goodMs: NaN })).toBeNull();
  });
});
