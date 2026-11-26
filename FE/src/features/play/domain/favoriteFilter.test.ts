import { describe, expect, it } from 'vitest';
import { visibleSongs, withFavorite } from './favoriteFilter';

const songs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

describe('withFavorite', () => {
  it('켜면 끝에 넣고, 끄면 뺀다', () => {
    expect(withFavorite([1, 2], 3, true)).toEqual([1, 2, 3]);
    expect(withFavorite([1, 2, 3], 2, false)).toEqual([1, 3]);
  });

  it('바뀌지 않으면 같은 배열을 돌려준다', () => {
    const ids = [1, 2];
    expect(withFavorite(ids, 2, true)).toBe(ids);
    expect(withFavorite(ids, 9, false)).toBe(ids);
  });
});

describe('visibleSongs', () => {
  it('필터가 꺼져 있으면 받은 배열 그대로다', () => {
    expect(visibleSongs(songs, new Set([2]), new Set(), false)).toBe(songs);
  });

  it('필터가 켜져 있으면 즐겨찾기한 곡만 원래 순서로 남긴다', () => {
    expect(visibleSongs(songs, new Set([4, 2]), new Set(), true)).toEqual([{ id: 2 }, { id: 4 }]);
  });

  it('남겨 둘 곡은 즐겨찾기가 아니어도 남는다', () => {
    expect(visibleSongs(songs, new Set([4]), new Set([1]), true)).toEqual([{ id: 1 }, { id: 4 }]);
  });

  it('즐겨찾기가 없으면 빈 목록이다', () => {
    expect(visibleSongs(songs, new Set(), new Set(), true)).toEqual([]);
  });
});
