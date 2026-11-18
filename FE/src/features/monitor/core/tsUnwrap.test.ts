import { describe, expect, it } from 'vitest';
import { nearBrowserMs, normalizeOffsetMs, WRAP_MS, WRAP_US } from './tsUnwrap';

describe('nearBrowserMs · normalizeOffsetMs (바퀴 수를 세지 않는 환산)', () => {
  it('오프셋이 없으면 null', () => {
    expect(nearBrowserMs(5000, null, 10)).toBeNull();
  });

  it('오프셋이 몇 바퀴를 품고 있든 수신 시각에 가장 가까운 값을 낸다', () => {
    // 참값: 센서 5ms + 오프셋 100 = 105, 수신 110
    expect(nearBrowserMs(5000, 100, 110)).toBeCloseTo(105, 6);
    expect(nearBrowserMs(5000, 100 + WRAP_MS, 110)).toBeCloseTo(105, 6);
    expect(nearBrowserMs(5000, 100 - 2 * WRAP_MS, 110)).toBeCloseTo(105, 6);
  });

  it('랩 직전 값과 직후 값이 수신 시각 기준으로 이어진다', () => {
    const offset = 1000 - (WRAP_US - 2000) / 1000; // 랩 2ms 전의 센서 시각이 브라우저 1000
    const a = nearBrowserMs(WRAP_US - 2000, offset, 1003) as number;
    const b = nearBrowserMs(3000, offset, 1008) as number; // 랩 뒤 3ms
    expect(a).toBeCloseTo(1000, 6);
    expect(b).toBeCloseTo(1005, 6);
  });

  it('오프셋을 기준값과 반 바퀴 이내로 맞춘다', () => {
    expect(normalizeOffsetMs(1000, 1000)).toBe(1000);
    expect(normalizeOffsetMs(1003 + WRAP_MS, 1000)).toBeCloseTo(1003, 6);
    expect(normalizeOffsetMs(997 - 3 * WRAP_MS, 1000)).toBeCloseTo(997, 6);
  });
});
