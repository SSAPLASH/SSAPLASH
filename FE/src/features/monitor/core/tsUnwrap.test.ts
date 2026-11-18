import { describe, expect, it } from 'vitest';
import { futureMs, nearBrowserMs, normalizeOffsetMs, toBrowserMs, TsUnwrap, WRAP_MS, WRAP_US } from './tsUnwrap';

describe('TsUnwrap', () => {
  it('랩어라운드 전후로 단조 증가한다', () => {
    const u = new TsUnwrap();
    const seq = [0xffffff00, 0xffffffa0, 0x100, 0x200].map((v) => u.feed(0, v));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]);
    expect(seq[2]).toBe(0x100 + WRAP_US);
  });

  it('랩 뒤 늦게 온 옛 패킷은 이번 값에만 -WRAP을 적용하고 상태는 유지한다', () => {
    const u = new TsUnwrap();
    u.feed(0, 0xffffff00);
    expect(u.feed(0, 0x100)).toBe(0x100 + WRAP_US);
    // 랩 전에 보낸 늦은 패킷
    expect(u.feed(0, 0xfffffff0)).toBe(0xfffffff0);
    // 상태가 유지되어 다음 정상 패킷은 계속 이어진다
    expect(u.feed(0, 0x300)).toBe(0x300 + WRAP_US);
  });

  it('스틱 0·1은 독립이다', () => {
    const u = new TsUnwrap();
    u.feed(0, 0xffffff00);
    u.feed(0, 0x100);
    expect(u.feed(1, 0x500)).toBe(0x500);
  });

  it('reset은 지정한 스틱(또는 전체)만 초기화한다', () => {
    const u = new TsUnwrap();
    for (const s of [0, 1] as const) {
      u.feed(s, 0xffffff00);
      u.feed(s, 0x100);
    }
    u.reset(0);
    expect(u.feed(0, 0x200)).toBe(0x200);
    expect(u.feed(1, 0x200)).toBe(0x200 + WRAP_US);
    u.reset();
    expect(u.feed(1, 0x200)).toBe(0x200);
  });
});

describe('toBrowserMs · futureMs', () => {
  it('오프셋이 없으면 null', () => {
    expect(toBrowserMs(5000, null)).toBeNull();
    expect(futureMs(null, 10)).toBeNull();
  });
  it('µs를 ms로 바꿔 오프셋을 더하고 수신 시각과의 차를 낸다', () => {
    const t = toBrowserMs(5000, 100);
    expect(t).toBe(105);
    expect(futureMs(t, 100)).toBe(5);
  });
});

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
