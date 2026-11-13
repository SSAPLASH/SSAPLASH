import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRole, InputSourceKind } from '@/domain/events';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { BaseInputSource } from '@/input/source/InputSource';
import { CLOCK_DIAG_INTERVAL_MS, publishClock, startClockDiag } from './clockDiag';

class MockSource extends BaseInputSource {
  readonly kind = 'serial' as InputSourceKind;
  readonly label = 'mock';
  calls = 0;
  offsets: (number | null)[] = [100, 200, 300, null];
  clockOffsetOf(role: DeviceRole): number | null {
    this.calls++;
    return this.offsets[role];
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

/** clockOffsetOf가 없는 소스 */
class PlainSource extends BaseInputSource {
  readonly kind = 'pointer' as InputSourceKind;
  readonly label = 'plain';
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

let stop: (() => void) | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

const listen = () => {
  const got: DiagEvent[] = [];
  const off = diagTap.subscribe((e) => got.push(e));
  return { got, off };
};

describe('clock 진단 줄 (PLAY-002 실연주 진단)', () => {
  it('구독자가 있으면 10초마다 role 0~3 오프셋 4개를 낸다', () => {
    const src = new MockSource();
    const { got, off } = listen();
    stop = startClockDiag(() => src);
    vi.advanceTimersByTime(CLOCK_DIAG_INTERVAL_MS - 1);
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: 'clock', offsets: [100, 200, 300, null], source: 'serial' });
    vi.advanceTimersByTime(CLOCK_DIAG_INTERVAL_MS * 2);
    expect(got).toHaveLength(3);
    off();
  });

  it('구독자가 없으면 내지 않고 소스도 읽지 않는다. 다시 붙으면 낸다', () => {
    const src = new MockSource();
    stop = startClockDiag(() => src);
    vi.advanceTimersByTime(CLOCK_DIAG_INTERVAL_MS * 3);
    expect(src.calls).toBe(0);
    const { got, off } = listen();
    vi.advanceTimersByTime(CLOCK_DIAG_INTERVAL_MS);
    expect(got).toHaveLength(1);
    off();
    vi.advanceTimersByTime(CLOCK_DIAG_INTERVAL_MS);
    expect(got).toHaveLength(1);
  });

  it('활성 센서가 없으면 내지 않는다. clockOffsetOf가 없는 소스는 전부 null', () => {
    const { got, off } = listen();
    publishClock(null);
    expect(got).toHaveLength(0);
    publishClock(new PlainSource());
    expect(got[0]).toMatchObject({ type: 'clock', offsets: [null, null, null, null], source: 'pointer' });
    off();
  });

  it('해제하면 타이머가 멈춘다', () => {
    const { got, off } = listen();
    stop = startClockDiag(() => new MockSource());
    stop();
    stop = null;
    vi.advanceTimersByTime(CLOCK_DIAG_INTERVAL_MS * 2);
    expect(got).toHaveLength(0);
    off();
  });
});
