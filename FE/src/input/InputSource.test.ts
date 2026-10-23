// ClockSync 검증: 센서 µs 시각 랩어라운드 펼치기.
import { describe, expect, it } from 'vitest';
import { ClockSync, WRAP_MS } from './InputSource';

/** 센서 시각 base에서 오프셋 0(센서 시각 = 브라우저 시각)으로 맞춘 동기화 상태 */
function synced(base = 0): ClockSync {
  const c = new ClockSync();
  c.addSample(base, base, base);
  return c;
}

describe('ClockSync 랩어라운드 펼치기', () => {
  it('센서 ms 4294000 → 500 순서로 들어와도 단조 증가', () => {
    const c = synced(4294000);
    const a = c.toBrowserTime(4294000, 0);
    const b = c.toBrowserTime(500, 0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeCloseTo(500 + WRAP_MS);
  });

  it('랩 뒤 늦게 온 랩 전 패킷은 그 값만 -WRAP, 이후 정상', () => {
    const c = synced(4294000);
    const wrapped = c.toBrowserTime(500, 0);
    const late = c.toBrowserTime(4294900, 0);
    expect(late).toBeCloseTo(4294900);
    expect(late).toBeLessThan(wrapped);
    expect(c.toBrowserTime(600, 0)).toBeCloseTo(600 + WRAP_MS);
  });

  it('addSample의 t1도 펼쳐 오프셋이 랩 전후 연속', () => {
    const c = new ClockSync();
    c.toBrowserTime(4294000, 0);
    // 센서가 랩한 직후(t1 = 500)의 SYNC_ACK. 펼친 t1은 500 + WRAP_MS이므로 오프셋은 브라우저 시각에서 그만큼 뺀 값
    c.addSample(4295467 - 20, 500, 4295467 + 20);
    expect(c.offset).toBeCloseTo(4295467 - (500 + WRAP_MS));
  });

  it('동기화 전에는 recvTime을 돌려주되 펼침 상태는 갱신한다', () => {
    const c = new ClockSync();
    expect(c.toBrowserTime(4294000, 77)).toBe(77);
    expect(c.toBrowserTime(500, 88)).toBe(88);
    // 펼친 t1 = 500 + WRAP_MS 기준으로 오프셋이 잡히므로 이후 600도 같은 기준
    c.addSample(500, 500, 500);
    expect(c.toBrowserTime(600, 0)).toBeCloseTo(600);
  });

  it('reset 후 펼침 상태가 초기화된다', () => {
    const c = synced(4294000);
    c.toBrowserTime(500, 0);
    c.reset();
    expect(c.offset).toBeNull();
    c.addSample(0, 0, 0);
    expect(c.toBrowserTime(600, 0)).toBeCloseTo(600);
  });
});
