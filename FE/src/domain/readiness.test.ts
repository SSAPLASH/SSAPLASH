// readiness 단위 테스트: 키보드 면제, 누락 조합, 전부 충족.
import { describe, expect, it } from 'vitest';
import { readiness } from './readiness';

const base = { sensorKind: 'pointer', connected: [false, false] as [boolean, boolean], firstSetupDone: false, activePresetId: null };

describe('readiness', () => {
  it('키보드 전용이면 아무것도 없어도 준비됨', () => {
    expect(readiness({ ...base, sensorKind: 'none' })).toEqual({ ready: true, missing: [] });
  });

  it('아무것도 없으면 세 조건이 순서대로 누락', () => {
    expect(readiness(base)).toEqual({ ready: false, missing: ['stick', 'firstSetup', 'preset'] });
  });

  it('스틱만 연결되면 최초 설정·프리셋 누락', () => {
    expect(readiness({ ...base, connected: [false, true] }).missing).toEqual(['firstSetup', 'preset']);
  });

  it('스틱·최초 설정이 충족되면 프리셋만 누락', () => {
    expect(readiness({ ...base, connected: [true, false], firstSetupDone: true }).missing).toEqual(['preset']);
  });

  it('프리셋만 적용되면 스틱·최초 설정 누락', () => {
    expect(readiness({ ...base, activePresetId: 'p1' }).missing).toEqual(['stick', 'firstSetup']);
  });

  it('전부 충족하면 준비됨', () => {
    expect(readiness({ ...base, connected: [true, true], firstSetupDone: true, activePresetId: 'p1' })).toEqual({
      ready: true,
      missing: [],
    });
  });
});
