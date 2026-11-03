import { describe, expect, it } from 'vitest';
import { addPending, createDeviceStates, MAX_PENDING_SYNC, resetClockIfDue, resetDevice } from './deviceState';

describe('createDeviceStates', () => {
  it('role 0~3 네 칸이 서로 독립적인 상태로 만들어진다', () => {
    const d = createDeviceStates();
    expect(d.map((x) => x.role)).toEqual([0, 1, 2, 3]);
    expect(d.every((x) => !x.linked && x.heldBattery === undefined && !x.heldUnconfigured && x.lastClockResetAt === null)).toBe(true);
    expect(d[0].clock).not.toBe(d[1].clock);
    expect(d[0].pending).not.toBe(d[1].pending);
  });
});

describe('resetDevice', () => {
  it('시계·대기·연결·보류·초기화 시각을 모두 비운다', () => {
    const [s] = createDeviceStates();
    s.clock.addSample(0, 1000, 10);
    s.pending.set(1, 1);
    s.linked = true;
    s.heldBattery = 80;
    s.heldUnconfigured = true;
    s.lastClockResetAt = 500;
    resetDevice(s);
    expect(s.clock.offset).toBeNull();
    expect(s.pending.size).toBe(0);
    expect(s.linked).toBe(false);
    expect(s.heldBattery).toBeUndefined();
    expect(s.heldUnconfigured).toBe(false);
    expect(s.lastClockResetAt).toBeNull();
  });
});

describe('resetClockIfDue', () => {
  it('처음에는 초기화하고 시각을 기록한다', () => {
    const [s] = createDeviceStates();
    s.clock.addSample(0, 1000, 10);
    s.pending.set(1, 1);
    expect(resetClockIfDue(s, 5000)).toBe(true);
    expect(s.lastClockResetAt).toBe(5000);
    expect(s.clock.offset).toBeNull();
    expect(s.pending.size).toBe(0);
  });

  it('2초 안의 두 번째 신호는 건너뛴다(시계·대기 유지)', () => {
    const [s] = createDeviceStates();
    resetClockIfDue(s, 5000);
    s.clock.addSample(0, 1000, 10);
    s.pending.set(2, 2);
    expect(resetClockIfDue(s, 6999)).toBe(false);
    expect(s.lastClockResetAt).toBe(5000);
    expect(s.clock.offset).not.toBeNull();
    expect(s.pending.size).toBe(1);
  });

  it('정확히 2초 지나면 다시 초기화한다', () => {
    const [s] = createDeviceStates();
    resetClockIfDue(s, 5000);
    s.clock.addSample(0, 1000, 10);
    expect(resetClockIfDue(s, 7000)).toBe(true);
    expect(s.lastClockResetAt).toBe(7000);
    expect(s.clock.offset).toBeNull();
  });

  it('minGapMs를 바꿀 수 있다', () => {
    const [s] = createDeviceStates();
    resetClockIfDue(s, 0);
    expect(resetClockIfDue(s, 500, 400)).toBe(true);
    expect(resetClockIfDue(s, 700, 400)).toBe(false);
  });

  it('칸마다 따로 센다', () => {
    const d = createDeviceStates();
    resetClockIfDue(d[0], 1000);
    expect(resetClockIfDue(d[1], 1500)).toBe(true);
  });
});

describe('addPending', () => {
  it(`${MAX_PENDING_SYNC}개를 넘으면 오래된 것부터 지운다`, () => {
    const [s] = createDeviceStates();
    for (let i = 0; i < MAX_PENDING_SYNC + 3; i++) addPending(s, i, i * 10);
    expect(s.pending.size).toBe(MAX_PENDING_SYNC);
    expect(s.pending.has(0)).toBe(false);
    expect(s.pending.has(2)).toBe(false);
    expect(s.pending.get(3)).toBe(30);
    expect(s.pending.has(MAX_PENDING_SYNC + 2)).toBe(true);
  });
});
