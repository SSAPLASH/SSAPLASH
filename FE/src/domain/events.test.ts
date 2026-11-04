import { describe, expect, it } from 'vitest';
import { isSensorSource } from './events';

describe('isSensorSource', () => {
  it.each(['keyboard', 'preview', 'touch'])("'%s'는 센서가 아니다", (s) => {
    expect(isSensorSource(s)).toBe(false);
  });

  it('source가 없는 이전 기록은 센서가 아니다', () => {
    expect(isSensorSource(undefined)).toBe(false);
  });

  it.each(['ble', 'pointer', 'webserial'])("'%s'는 센서다", (s) => {
    expect(isSensorSource(s)).toBe(true);
  });
});
