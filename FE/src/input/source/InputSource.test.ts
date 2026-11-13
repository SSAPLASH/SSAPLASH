// ClockSync 검증: 센서 µs 시각 랩어라운드 펼치기, 흐르는 시계 따라가기.
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

describe('ClockSync 한 바퀴(71.6분) 전후', () => {
  it('랩 직전 SYNC → 랩 직후 HIT → 랩 직후 SYNC 순서에서 타격 시각과 오프셋이 연속이다', () => {
    const c = new ClockSync();
    const B0 = 10_000; // 브라우저 시각
    const S0 = WRAP_MS - 1000; // 그때 센서 시각(랩 1초 전)
    // 랩 직전 SYNC (왕복 4ms)
    c.addSample(B0 - 2, S0, B0 + 2);
    const before = c.offset as number;
    expect(before).toBeCloseTo(B0 - S0, 6);

    // 1.5초 뒤 타격: 센서 시각은 랩을 넘어 500ms. 3ms 뒤에 도착
    expect(c.toBrowserTime(500, B0 + 1503)).toBeCloseTo(B0 + 1500, 6);

    // 2.5초 뒤 SYNC: 센서 시각 1500ms
    c.addSample(B0 + 2498, 1500, B0 + 2502);
    expect(c.offset as number).toBeCloseTo(before, 6);
    expect(c.targetOffset as number).toBeCloseTo(before, 6);

    // 그 뒤 타격도 같은 기준
    expect(c.toBrowserTime(2000, B0 + 3003)).toBeCloseTo(B0 + 3000, 6);
  });

  it('랩 직후 첫 패킷이 SYNC여도 같다', () => {
    const c = new ClockSync();
    const B0 = 10_000;
    const S0 = WRAP_MS - 1000;
    c.addSample(B0 - 2, S0, B0 + 2);
    const before = c.offset as number;
    c.addSample(B0 + 1498, 500, B0 + 1502);
    expect(c.offset as number).toBeCloseTo(before, 6);
    expect(c.toBrowserTime(1000, B0 + 2003)).toBeCloseTo(B0 + 2000, 6);
  });

  it('랩 뒤에 초기화돼도 새 오프셋이 한 바퀴를 흡수해 타격 시각이 맞는다', () => {
    const c = new ClockSync();
    const B0 = 10_000;
    c.addSample(B0 - 2, WRAP_MS - 1000, B0 + 2);
    c.toBrowserTime(500, B0 + 1503);
    c.reset();
    c.addSample(B0 + 2498, 1500, B0 + 2502);
    expect(c.toBrowserTime(2000, B0 + 3003)).toBeCloseTo(B0 + 3000, 6);
  });
});

describe('ClockSync 흐르는 센서 시계', () => {
  it('분당 30ms 흐르는 시계로 10분 연주해도 타격 시각 오차가 10ms 미만이다', () => {
    const c = new ClockSync();
    // 센서 시계는 브라우저보다 초당 0.5ms 느리게 간다. 브라우저 시각 b일 때 센서 시각
    const sensorAt = (b: number) => 5000 + b * (1 - 0.0005);
    let worst = 0;
    for (let b = 0; b <= 600_000; b += 1000) {
      const rtt = 4 + ((b / 1000) % 5);
      c.addSample(b - rtt / 2, sensorAt(b), b + rtt / 2);
      // 250ms마다 타격, 3ms 뒤 도착
      for (const dt of [100, 350, 600, 850]) {
        const hitAt = b + dt;
        worst = Math.max(worst, Math.abs(c.toBrowserTime(sensorAt(hitAt), hitAt + 3) - hitAt));
      }
    }
    expect(worst).toBeLessThan(10);
  });

  it('rtt는 역대 최소가 아니라 최근 창 안 최소다', () => {
    const c = new ClockSync();
    c.addSample(0, 0, 2);
    expect(c.rtt).toBe(2);
    c.addSample(20_000, 20_000, 20_006);
    expect(c.rtt).toBe(6);
  });
});
