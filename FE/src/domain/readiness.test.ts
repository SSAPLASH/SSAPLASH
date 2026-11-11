// readiness 단위 테스트: 키보드 면제, 누락 조합, 전부 충족.
import { describe, expect, it } from 'vitest';
import { READINESS_MESSAGES, anchorsReady, calibrationReady, readiness, stickMissingText } from './readiness';

const base = {
  sensorKind: 'pointer',
  connected: [false, false] as [boolean, boolean],
  pedal: [true, true] as [boolean, boolean],
  firstSetupDone: false,
};

describe('readiness', () => {
  it('키보드 전용이면 아무것도 없어도 준비됨', () => {
    expect(readiness({ ...base, sensorKind: 'none' })).toEqual({ ready: true, missing: [] });
  });

  it('아무것도 없으면 두 조건이 순서대로 누락(프리셋 조건은 없다, UX-64 D1)', () => {
    expect(readiness(base)).toEqual({ ready: false, missing: ['stick', 'firstSetup'] });
    expect('preset' in READINESS_MESSAGES).toBe(false);
  });

  it('한 손만 연결돼도 스틱 누락(양손 모두 필요)', () => {
    expect(readiness({ ...base, connected: [false, true] }).missing).toEqual(['stick', 'firstSetup']);
    expect(readiness({ ...base, connected: [true, false], firstSetupDone: true }).missing).toEqual(['stick']);
  });

  it('양손·최초 설정이 충족되면 준비됨', () => {
    expect(readiness({ ...base, connected: [true, true], firstSetupDone: true })).toEqual({ ready: true, missing: [] });
  });

  it('포인터·BLE 등 동글이 아닌 소스는 페달을 보지 않는다(D3: 페달은 동글로만 붙는다)', () => {
    const ok = { ...base, connected: [true, true] as [boolean, boolean], firstSetupDone: true };
    expect(readiness({ ...ok, pedal: [false, false] })).toEqual({ ready: true, missing: [] });
    expect(readiness({ ...ok, sensorKind: 'ble', pedal: [false, false] })).toEqual({ ready: true, missing: [] });
  });

  it('동글 소스에서 발이 빠지면 pedal 누락(한 발만이어도), 손과 별개로 판정한다', () => {
    const dongle = { ...base, sensorKind: 'webserial' };
    const ok = { ...dongle, connected: [true, true] as [boolean, boolean], firstSetupDone: true };
    expect(readiness({ ...ok, pedal: [false, true] }).missing).toEqual(['pedal']);
    expect(readiness({ ...ok, pedal: [true, false] }).missing).toEqual(['pedal']);
    expect(readiness({ ...ok, pedal: [false, false] })).toEqual({ ready: false, missing: ['pedal'] });
    expect(readiness({ ...dongle, pedal: [false, false] }).missing).toEqual(['stick', 'pedal', 'firstSetup']);
    expect(READINESS_MESSAGES.pedal).toBe('페달을 연결해 주세요');
  });

  it('키보드 전용은 페달이 없어도 면제', () => {
    expect(readiness({ ...base, sensorKind: 'none', pedal: [false, false] })).toEqual({ ready: true, missing: [] });
  });

  it('전부 충족하면 준비됨', () => {
    expect(readiness({ ...base, connected: [true, true], firstSetupDone: true })).toEqual({
      ready: true,
      missing: [],
    });
  });
});

describe('calibrationReady (UX-64 D7)', () => {
  it('시스템 기본은 앵커가 없어도 완료, 재정렬이 필요한 손이 있으면 미완료', () => {
    expect(calibrationReady({ systemPreset: true, connected: [true, true], hasAnchors: [false, false] })).toBe(true);
    expect(calibrationReady({ systemPreset: true, connected: [true, true], hasAnchors: [false, false], realignNeeded: [false, true] })).toBe(false);
  });
  it('사용자 프리셋은 연결된 손마다 앵커가 있어야 완료(anchorsReady)', () => {
    expect(calibrationReady({ systemPreset: false, connected: [true, true], hasAnchors: [true, false] })).toBe(false);
    expect(calibrationReady({ systemPreset: false, connected: [true, true], hasAnchors: [true, true] })).toBe(true);
    expect(calibrationReady({ systemPreset: false, connected: [true, true], hasAnchors: [true, true], realignNeeded: [true, false] })).toBe(false);
  });
});

describe('stickMissingText', () => {
  it('빠진 손을 짚는다', () => {
    expect(stickMissingText([false, false])).toBe('왼손·오른손 스틱을 연결해 주세요');
    expect(stickMissingText([true, false])).toBe('오른손 스틱을 연결해 주세요');
    expect(stickMissingText([false, true])).toBe('왼손 스틱을 연결해 주세요');
  });
  it('둘 다 연결이면 일반형', () => {
    expect(stickMissingText([true, true])).toBe(READINESS_MESSAGES.stick);
  });
});

describe('anchorsReady (PLAY-004 D9)', () => {
  it('연결된 손마다 앵커가 있어야 true', () => {
    expect(anchorsReady([true, true], [true, true])).toBe(true);
    expect(anchorsReady([true, true], [true, false])).toBe(false);
    expect(anchorsReady([true, false], [true, false])).toBe(true);
    expect(anchorsReady([false, true], [true, false])).toBe(false);
  });
  it('연결된 손이 없으면 앵커가 하나라도 있으면 true', () => {
    expect(anchorsReady([false, false], [false, true])).toBe(true);
    expect(anchorsReady([false, false], [false, false])).toBe(false);
  });
});
