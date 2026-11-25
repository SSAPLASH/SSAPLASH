// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSpeedSeconds, writeSpeedSeconds } from './speedDurationPref';

const KEY = 'ssaplash.mini.speedSeconds.v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('speedDurationPref', () => {
  it('저장된 값이 없으면 10초다', () => {
    expect(readSpeedSeconds()).toBe(10);
  });

  it('쓴 값을 다시 읽는다', () => {
    writeSpeedSeconds(5);
    expect(localStorage.getItem(KEY)).toBe('5');
    expect(readSpeedSeconds()).toBe(5);
    writeSpeedSeconds(10);
    expect(readSpeedSeconds()).toBe(10);
  });

  it('모르는 값이 저장돼 있으면 10초다', () => {
    localStorage.setItem(KEY, '7');
    expect(readSpeedSeconds()).toBe(10);
    localStorage.setItem(KEY, 'abc');
    expect(readSpeedSeconds()).toBe(10);
  });

  it('읽지 못하면 10초로 진행한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('막힘');
    });
    expect(readSpeedSeconds()).toBe(10);
  });

  it('쓰지 못해도 예외가 나가지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('가득 참');
    });
    expect(() => writeSpeedSeconds(5)).not.toThrow();
  });
});
