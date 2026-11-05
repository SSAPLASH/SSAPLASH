import { describe, expect, it } from 'vitest';
import { COVER_MAX_INPUT_BYTES, COVER_REFRESH_MIN_MS, centerSquareCrop, coverRefreshDue, precheckCover } from './songCover';

describe('precheckCover', () => {
  it('jpeg·png·webp는 통과한다', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(precheckCover({ type, size: 1000 })).toEqual({ ok: true });
  });

  it('다른 형식은 UNSUPPORTED', () => {
    expect(precheckCover({ type: 'image/gif', size: 1000 })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
    expect(precheckCover({ type: '', size: 1000 })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
  });

  it('원본 10 MiB 이하만, 빈 파일은 EMPTY', () => {
    expect(precheckCover({ type: 'image/png', size: COVER_MAX_INPUT_BYTES })).toEqual({ ok: true });
    expect(precheckCover({ type: 'image/png', size: COVER_MAX_INPUT_BYTES + 1 })).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(precheckCover({ type: 'image/png', size: 0 })).toEqual({ ok: false, reason: 'EMPTY' });
  });
});

describe('centerSquareCrop', () => {
  it('가로로 긴 이미지는 좌우를 자른다', () => {
    expect(centerSquareCrop(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
  });

  it('세로로 긴 이미지는 위아래를 자른다', () => {
    expect(centerSquareCrop(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
  });

  it('정사각형은 그대로, 홀수 차이는 내림', () => {
    expect(centerSquareCrop(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
    expect(centerSquareCrop(11, 6)).toEqual({ sx: 2, sy: 0, size: 6 });
  });

  it('크기를 알 수 없으면 null', () => {
    expect(centerSquareCrop(0, 100)).toBeNull();
    expect(centerSquareCrop(NaN, 100)).toBeNull();
  });
});

describe('coverRefreshDue', () => {
  it('처음(마지막 재조회 없음)에는 바로 다시 읽는다', () => {
    expect(coverRefreshDue(null, 0)).toBe(true);
  });

  it('1분 안의 다른 오류는 다시 읽지 않고, 1분이 지나면 다시 읽는다', () => {
    expect(coverRefreshDue(1_000, 1_000 + COVER_REFRESH_MIN_MS - 1)).toBe(false);
    expect(coverRefreshDue(1_000, 1_000 + COVER_REFRESH_MIN_MS)).toBe(true);
  });
});
