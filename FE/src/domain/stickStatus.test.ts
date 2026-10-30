import { describe, expect, it } from 'vitest';
import { BATTERY_CRITICAL_PCT, BATTERY_LOW_PCT, smoothBattery, stickStatus } from './stickStatus';

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
  it('10% 이하는 critical(곧 꺼짐), 11%는 low', () => {
    expect(BATTERY_CRITICAL_PCT).toBe(10);
    expect(stickStatus(true, 10, 0).battery).toBe('critical');
    expect(stickStatus(true, 0, 0).battery).toBe('critical');
    expect(stickStatus(true, 11, 0).battery).toBe('low');
  });
  it('배터리를 모르면 unknown과 "–"', () => {
    expect(stickStatus(true, null, 0)).toMatchObject({ battery: 'unknown', batteryText: '–' });
  });
  it('끊겨도 마지막 배터리 값을 그대로 보인다', () => {
    expect(stickStatus(false, 55, 1)).toMatchObject({ dot: 'off', batteryText: '55%' });
  });
});

describe('smoothBattery', () => {
  it('최근 3개 평균을 반올림한다', () => {
    let h: number[] = [];
    const vals: number[] = [];
    for (const v of [64, 61, 65, 62]) {
      const r = smoothBattery(h, v);
      h = r.history;
      vals.push(r.value);
    }
    expect(vals).toEqual([64, 63, 63, 63]);
    expect(h).toEqual([61, 65, 62]);
  });
  it('이력을 고치지 않는다', () => {
    const h = [50];
    smoothBattery(h, 40);
    expect(h).toEqual([50]);
  });
});
