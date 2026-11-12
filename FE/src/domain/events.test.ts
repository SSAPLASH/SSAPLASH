import { describe, expect, it } from 'vitest';
import { isFootHit, isSensorSource } from './events';

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

describe('isFootHit', () => {
  it('foot가 있으면(하이햇 페달 2·킥 3) 발 타격이다', () => {
    expect(isFootHit({ foot: 2 })).toBe(true);
    expect(isFootHit({ foot: 3 })).toBe(true);
  });

  it('foot가 없는 손·키보드 타격은 발 타격이 아니다', () => {
    expect(isFootHit({})).toBe(false);
  });
});
