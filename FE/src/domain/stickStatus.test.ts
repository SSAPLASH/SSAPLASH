import { describe, expect, it } from 'vitest';
import { BATTERY_LOW_PCT, stickStatus } from './stickStatus';

describe('stickStatus', () => {
  it('연결 + 정상 배터리', () => {
    const v = stickStatus(true, 82, 0);
    expect(v).toMatchObject({ dot: 'on', battery: 'ok', batteryText: '82%', label: '왼', handName: '왼손' });
    expect(v.text).toBe('왼손 연결됨 · 82%');
  });
  it('오른손 라벨', () => {
    expect(stickStatus(true, 64, 1)).toMatchObject({ label: '오', handName: '오른손' });
  });
  it('20% 이하는 low, 21%는 ok', () => {
    expect(BATTERY_LOW_PCT).toBe(20);
    expect(stickStatus(true, 20, 0).battery).toBe('low');
    expect(stickStatus(true, 21, 0).battery).toBe('ok');
  });
  it('배터리를 모르면 unknown과 "–"', () => {
    expect(stickStatus(true, null, 0)).toMatchObject({ battery: 'unknown', batteryText: '–' });
  });
  it('끊겨도 마지막 배터리 값을 그대로 보인다', () => {
    expect(stickStatus(false, 55, 1)).toMatchObject({ dot: 'off', batteryText: '55%' });
  });
});
