import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClickLevel } from '@/domain/time/metronome';

vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: { click: vi.fn(() => null), renderAheadMs: vi.fn(() => 0) },
}));

import { startCountIn } from './tempoCountIn';

const INTERVAL = 500; // 120 BPM

interface ClickCall {
  planned: number;
  level: ClickLevel;
  calledAt: number;
}

function setup(options: { beats?: number; shift?: number; ahead?: number; nullFrom?: number } = {}) {
  const beats = options.beats ?? 8;
  const firstAt = performance.now() + 600;
  const clicks: ClickCall[] = [];
  const beatCalls: { index: number; at: number }[] = [];
  const ends: { arg: number; at: number }[] = [];
  const onFail = vi.fn();
  const click = vi.fn((atMs: number, level: ClickLevel) => {
    clicks.push({ planned: atMs, level, calledAt: performance.now() });
    if (options.nullFrom !== undefined && clicks.length > options.nullFrom) return null;
    return atMs + (options.shift ?? 0);
  });
  const handle = startCountIn({
    bpm: 120,
    beats,
    firstAt,
    onBeat: (index) => beatCalls.push({ index, at: performance.now() }),
    onEnd: (arg) => ends.push({ arg, at: performance.now() }),
    onFail,
    click,
    renderAheadMs: () => options.ahead ?? 0,
  });
  return { firstAt, clicks, beatCalls, ends, onFail, click, handle };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startCountIn', () => {
  it('박 수만큼 firstAt + i × 박 간격에 한 번씩 예약한다', () => {
    const { firstAt, clicks } = setup();
    vi.advanceTimersByTime(10000);
    expect(clicks.map((c) => c.planned)).toEqual(Array.from({ length: 8 }, (_, i) => firstAt + i * INTERVAL));
  });

  it('각 박은 100ms 앞 안에서만 예약한다', () => {
    const { clicks } = setup();
    vi.advanceTimersByTime(10000);
    for (const c of clicks) {
      expect(c.planned - c.calledAt).toBeLessThanOrEqual(100);
      expect(c.planned - c.calledAt).toBeGreaterThan(0);
    }
  });

  it('0·4번째 박은 accent, 나머지는 beat', () => {
    const { clicks } = setup();
    vi.advanceTimersByTime(10000);
    expect(clicks.map((c) => c.level)).toEqual(['accent', 'beat', 'beat', 'beat', 'accent', 'beat', 'beat', 'beat']);
  });

  it('onBeat는 예약할 때가 아니라 박 시각에 순서대로 한 번씩 부른다', () => {
    const { firstAt, beatCalls } = setup();
    vi.advanceTimersByTime(10000);
    expect(beatCalls.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(beatCalls.map((b) => b.at)).toEqual(Array.from({ length: 8 }, (_, i) => firstAt + i * INTERVAL));
  });

  it('onEnd는 한 번, 마지막 박에서 반 박 뒤에 실제 예약 시각을 받아 부른다', () => {
    const { firstAt, ends } = setup({ shift: 3 });
    vi.advanceTimersByTime(10000);
    const last = firstAt + 7 * INTERVAL + 3;
    expect(ends).toEqual([{ arg: last, at: last + INTERVAL / 2 }]);
  });

  it('renderAheadMs만큼 예약 창이 넓어진다', () => {
    const { firstAt, clicks } = setup({ ahead: 50 });
    vi.advanceTimersByTime(10000);
    expect(firstAt - clicks[0].calledAt).toBe(150);
    for (const c of clicks) expect(c.planned - c.calledAt).toBeLessThanOrEqual(150);
  });

  it('첫 박을 예약하지 못하면 비동기로 onFail 한 번, 그 뒤 아무것도 없다', () => {
    const { click, beatCalls, ends, onFail } = setup({ nullFrom: 0 });
    vi.advanceTimersByTime(600 - 100); // 첫 박 예약 시점 직전까지
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(10000);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(beatCalls).toEqual([]);
    expect(ends).toEqual([]);
  });

  it('onFail은 현재 호출이 끝난 뒤에 부른다', () => {
    const onFail = vi.fn();
    startCountIn({
      bpm: 120,
      beats: 8,
      firstAt: performance.now(),
      onBeat: vi.fn(),
      onEnd: vi.fn(),
      onFail,
      click: () => null,
      renderAheadMs: () => 0,
    });
    expect(onFail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('뒤 박에서 null이 와도 실패가 아니라 계획한 시각으로 끝까지 간다', () => {
    const { firstAt, beatCalls, ends, onFail } = setup({ nullFrom: 2 });
    vi.advanceTimersByTime(10000);
    expect(onFail).not.toHaveBeenCalled();
    expect(beatCalls).toHaveLength(8);
    const last = firstAt + 7 * INTERVAL;
    expect(ends).toEqual([{ arg: last, at: last + INTERVAL / 2 }]);
  });

  it('첫 박 전에 cancel하면 예약도 알림도 없다', () => {
    const { handle, click, beatCalls, ends, onFail } = setup();
    handle.cancel();
    vi.advanceTimersByTime(10000);
    expect(click).not.toHaveBeenCalled();
    expect(beatCalls).toEqual([]);
    expect(ends).toEqual([]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('도중에 cancel하면 그 뒤 예약과 알림이 멈춘다', () => {
    const { handle, click, beatCalls, ends, onFail } = setup();
    vi.advanceTimersByTime(600 + 2 * INTERVAL); // 0·1·2번째 박 알림 직후
    handle.cancel();
    const clickCount = click.mock.calls.length;
    const beatCount = beatCalls.length;
    vi.advanceTimersByTime(10000);
    expect(click.mock.calls.length).toBe(clickCount);
    expect(beatCalls.length).toBe(beatCount);
    expect(beatCalls.length).toBeLessThan(8);
    expect(ends).toEqual([]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('cancel을 두 번 불러도 괜찮다', () => {
    const { handle } = setup();
    handle.cancel();
    expect(() => handle.cancel()).not.toThrow();
  });

  it('onEnd 뒤 cancel도 괜찮다', () => {
    const { handle, ends } = setup();
    vi.advanceTimersByTime(10000);
    expect(ends).toHaveLength(1);
    expect(() => handle.cancel()).not.toThrow();
  });

  it('click을 넘기지 않으면 audioEngine.click을 쓰고, null이면 onFail', () => {
    const onFail = vi.fn();
    const onBeat = vi.fn();
    const onEnd = vi.fn();
    expect(() => startCountIn({ bpm: 120, beats: 8, firstAt: performance.now(), onBeat, onEnd, onFail })).not.toThrow();
    vi.advanceTimersByTime(10000);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onBeat).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
