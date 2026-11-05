import { describe, expect, it } from 'vitest';
import { devicesReady, pedalConnected, pedalRequired, pedalSetupLine, pedalStatus } from './pedalStatus';

const pedal = (l: boolean, r: boolean) => ({ connected: [l, r] as const });

describe('pedalConnected', () => {
  // 인수 조건: 두 발이 모두 붙었을 때만 연결(준비 조건·settle·일시정지가 쓰는 한 식)
  it('두 발이 모두 붙어야 참', () => {
    expect(pedalConnected(pedal(true, true))).toBe(true);
    expect(pedalConnected(pedal(true, false))).toBe(false);
    expect(pedalConnected(pedal(false, true))).toBe(false);
    expect(pedalConnected(pedal(false, false))).toBe(false);
  });
});

describe('pedalRequired', () => {
  // 인수 조건: 페달은 동글(webserial)에서만 필수, 키보드 전용 면제
  it('webserial만 필수다', () => {
    expect(pedalRequired('webserial')).toBe(true);
    for (const k of ['none', 'pointer', 'ble', 'websocket']) expect(pedalRequired(k)).toBe(false);
  });
});

describe('devicesReady', () => {
  // 인수 조건: 재연결 settle·waitForDevices — 양손 + (동글이면) 두 발
  it('동글: 양손과 두 발이 모두 있어야 참', () => {
    expect(devicesReady('webserial', [true, true], pedal(true, true))).toBe(true);
    expect(devicesReady('webserial', [true, true], pedal(true, false))).toBe(false);
    expect(devicesReady('webserial', [true, true], pedal(false, false))).toBe(false);
    expect(devicesReady('webserial', [true, false], pedal(true, true))).toBe(false);
    expect(devicesReady('webserial', [false, false], pedal(true, true))).toBe(false);
  });

  it('동글이 아니면 발은 보지 않고 양손만 본다', () => {
    expect(devicesReady('ble', [true, true], pedal(false, false))).toBe(true);
    expect(devicesReady('websocket', [true, true], pedal(false, false))).toBe(true);
    expect(devicesReady('ble', [true, false], pedal(true, true))).toBe(false);
  });
});

describe('pedalStatus', () => {
  // 인수 조건: 양발 연결 + 배터리 82 → 점 on, "페달 연결됨 · 82%"
  it('양발 연결과 배터리가 있으면 on과 배터리 문구', () => {
    expect(pedalStatus({ connected: [true, true], battery: 82 })).toEqual({
      dot: 'on',
      batteryText: '82%',
      text: '페달 연결됨 · 82%',
    });
  });

  // 인수 조건: 배터리를 모르면 "페달 연결됨"만
  it('배터리가 null이면 배터리 없이 연결됨', () => {
    expect(pedalStatus({ connected: [true, true], battery: null })).toEqual({
      dot: 'on',
      batteryText: null,
      text: '페달 연결됨',
    });
  });

  // 인수 조건: 한 발만 붙으면 off, 배터리 문구 없음
  it('한 발만 붙으면 off이고 "페달 연결 안 됨"', () => {
    for (const connected of [[true, false], [false, true]] as const) {
      expect(pedalStatus({ connected, battery: 82 })).toEqual({
        dot: 'off',
        batteryText: null,
        text: '페달 연결 안 됨',
      });
    }
  });

  // 인수 조건: 끊김이면 배터리 값이 남아 있어도 batteryText null
  it('끊김이면 배터리가 있어도 batteryText는 null', () => {
    const v = pedalStatus({ connected: [false, false], battery: 55 });
    expect(v.dot).toBe('off');
    expect(v.batteryText).toBeNull();
  });
});

describe('pedalSetupLine', () => {
  const off = { connected: [false, false] as const, battery: null };
  const on = { connected: [true, true] as const, battery: 82 };

  // 인수 조건: 끊김 + 동글 대기 중이면 동글 재탐색 안내를 붙인다
  it('끊김이면 동글을 다시 꽂아 달라는 안내가 붙는다', () => {
    expect(pedalSetupLine(off, 'waiting')).toBe('페달 연결 안 됨 · 페달을 켰다면 동글을 다시 꽂아 주세요');
    expect(pedalSetupLine(off, undefined)).toContain('동글을 다시 꽂아 주세요');
  });

  // 인수 조건: 동글 포트가 닫혀 있으면 동글 줄이 먼저 안내하므로 뒷문장 없음
  it('동글이 closed면 뒷문장이 없다', () => {
    expect(pedalSetupLine(off, 'closed')).toBe('페달 연결 안 됨');
  });

  // 인수 조건: 연결이면 안내 없이 상태 문구만
  it('연결이면 안내가 없다', () => {
    expect(pedalSetupLine(on, 'waiting')).toBe('페달 연결됨 · 82%');
  });
});
