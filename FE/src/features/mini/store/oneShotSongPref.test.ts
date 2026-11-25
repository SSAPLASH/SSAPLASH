// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ONE_SHOT_SONGS } from '@/features/mini/domain/oneShotSongs';
import { readOneShotSong, writeOneShotSong } from './oneShotSongPref';

const KEY = 'ssaplash.mini.oneShotSong.v1';
const FIRST = ONE_SHOT_SONGS[0].id;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('oneShotSongPref', () => {
  it('저장된 값이 없으면 첫 곡', () => {
    expect(readOneShotSong()).toBe('iwaly');
  });

  it('곡 표에 없는 id가 저장돼 있으면 첫 곡', () => {
    localStorage.setItem(KEY, 'nope');
    expect(readOneShotSong()).toBe(FIRST);
  });

  it('쓴 곡을 저장 키에 넣고 다시 읽는다', () => {
    writeOneShotSong('iwaly');
    expect(localStorage.getItem(KEY)).toBe('iwaly');
    expect(readOneShotSong()).toBe('iwaly');
  });

  it('저장 공간이 예외를 던지면 읽기는 첫 곡, 쓰기는 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readOneShotSong()).toBe(FIRST);
    expect(() => writeOneShotSong('iwaly')).not.toThrow();
  });
});
