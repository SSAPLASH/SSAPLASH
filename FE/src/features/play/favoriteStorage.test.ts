// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAVORITES_STORAGE_KEY, readLocalFavorites, writeLocalFavorites } from './favoriteStorage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('favoriteStorage', () => {
  it('저장한 곡 id를 그대로 읽는다', () => {
    expect(writeLocalFavorites([3, 1, 2])).toBe(true);
    expect(readLocalFavorites()).toEqual([3, 1, 2]);
    expect(localStorage.getItem(FAVORITES_STORAGE_KEY)).toBe('[3,1,2]');
  });

  it('값이 없으면 빈 배열이다', () => {
    expect(readLocalFavorites()).toEqual([]);
  });

  it('깨진 값·배열이 아닌 값은 빈 배열로 본다', () => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, '{oops');
    expect(readLocalFavorites()).toEqual([]);
    localStorage.setItem(FAVORITES_STORAGE_KEY, '{"a":1}');
    expect(readLocalFavorites()).toEqual([]);
  });

  it('숫자가 아닌 값·0·중복은 버린다', () => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([1, '2', null, 0, 1.5, 1, 7]));
    expect(readLocalFavorites()).toEqual([1, 7]);
  });

  it('저장소에 쓸 수 없으면 false를 돌려준다', () => {
    // 이 테스트 환경에서는 Storage.prototype을 바꿔 끼워도 적용되지 않아 전역을 통째로 바꾼다
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(writeLocalFavorites([1])).toBe(false);
  });
});
