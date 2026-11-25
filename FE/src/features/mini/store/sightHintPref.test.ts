// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSightHint, writeSightHint } from './sightHintPref';

const KEY = 'ssaplash.mini.sightHint.v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('sightHintPref', () => {
  it('저장된 값이 없으면 켬', () => {
    expect(readSightHint()).toBe('on');
  });

  it('off가 저장돼 있으면 끔', () => {
    localStorage.setItem(KEY, 'off');
    expect(readSightHint()).toBe('off');
  });

  it('알 수 없는 값이면 켬', () => {
    localStorage.setItem(KEY, 'garbage');
    expect(readSightHint()).toBe('on');
  });

  it('쓴 값을 다시 읽고 저장 키에 그대로 들어간다', () => {
    writeSightHint('off');
    expect(readSightHint()).toBe('off');
    expect(localStorage.getItem(KEY)).toBe('off');
    writeSightHint('on');
    expect(readSightHint()).toBe('on');
    expect(localStorage.getItem(KEY)).toBe('on');
  });

  it('저장 공간이 예외를 던지면 읽기는 켬, 쓰기는 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSightHint()).toBe('on');
    expect(() => writeSightHint('off')).not.toThrow();
  });
});
