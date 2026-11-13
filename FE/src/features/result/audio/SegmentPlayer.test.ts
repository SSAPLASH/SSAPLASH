import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEGMENT_LOOP_GAP_MS, type SegmentPlan } from '@/features/result/domain/segmentPlayback';
import { SEGMENT_START_LEAD_MS, SegmentPlayer } from './SegmentPlayer';

const plan: SegmentPlan = {
  events: [
    { atMs: 0, pad: 'KICK', velocity: 90 },
    { atMs: 500, pad: 'SNARE', velocity: 90 },
  ],
  lengthMs: 1000,
  fromMs: 4000,
  toMs: 5000,
};

function setup(opts: { loadFails?: boolean; withAcc?: boolean } = {}) {
  const cancels: ReturnType<typeof vi.fn>[] = [];
  const engine = {
    ensure: vi.fn(async () => ({}) as AudioContext),
    triggerScheduled: vi.fn(() => {
      const cancel = vi.fn();
      cancels.push(cancel);
      return { at: 0, cancel };
    }),
  };
  const acc = {
    load: vi.fn(async () => {
      if (opts.loadFails) throw new Error('fail');
    }),
    start: vi.fn(),
    stop: vi.fn(),
    setRate: vi.fn(),
  };
  const player = new SegmentPlayer(engine, opts.withAcc === false ? null : acc, { now: () => 10_000 });
  return { engine, acc, cancels, player };
}

const base = { rate: 1 as const, loop: false, accompanimentUrl: 'https://x/a.mp3' };
const startPerf = 10_000 + SEGMENT_START_LEAD_MS;

describe('SegmentPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('이벤트마다 startPerf + atMs로 예약하고 반주를 fromMs부터 시작한다', async () => {
    const { engine, acc, player } = setup();
    await player.play(plan, { ...base, rate: 0.75 });
    expect(engine.triggerScheduled).toHaveBeenCalledTimes(2);
    expect(engine.triggerScheduled).toHaveBeenNthCalledWith(1, 'KICK', 90, startPerf);
    expect(engine.triggerScheduled).toHaveBeenNthCalledWith(2, 'SNARE', 90, startPerf + 500);
    expect(acc.setRate).toHaveBeenCalledWith(0.75);
    expect(acc.start).toHaveBeenCalledWith(startPerf, 4000);
    expect(player.state).toBe('playing');
  });

  it('구간 길이가 지나면 반주를 멈추고, gap 뒤 onEnd 한 번·idle', async () => {
    const { acc, player } = setup();
    const onEnd = vi.fn();
    player.onEnd = onEnd;
    await player.play(plan, base);
    acc.stop.mockClear();
    vi.advanceTimersByTime(SEGMENT_START_LEAD_MS + 1000 - 1);
    expect(acc.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(acc.stop).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SEGMENT_LOOP_GAP_MS);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(player.state).toBe('idle');
  });

  it('loop면 gap 뒤 다시 예약하고 onEnd는 부르지 않는다', async () => {
    const { engine, player } = setup();
    const onEnd = vi.fn();
    player.onEnd = onEnd;
    await player.play(plan, { ...base, loop: true });
    await vi.advanceTimersByTimeAsync(SEGMENT_START_LEAD_MS + 1000 + SEGMENT_LOOP_GAP_MS);
    expect(engine.triggerScheduled).toHaveBeenCalledTimes(4);
    expect(onEnd).not.toHaveBeenCalled();
    expect(player.state).toBe('playing');
    player.stop();
  });

  it('stop()은 모든 예약을 취소하고 onEnd를 부르지 않는다', async () => {
    const { acc, cancels, player } = setup();
    const onEnd = vi.fn();
    player.onEnd = onEnd;
    await player.play(plan, base);
    player.stop();
    expect(cancels).toHaveLength(2);
    for (const c of cancels) expect(c).toHaveBeenCalledTimes(1);
    expect(acc.stop).toHaveBeenCalled();
    expect(player.state).toBe('idle');
    vi.advanceTimersByTime(5000);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('반주 load가 실패해도 합성음은 예약하고 반주는 시작하지 않는다', async () => {
    const { engine, acc, player } = setup({ loadFails: true });
    await player.play(plan, base);
    expect(engine.triggerScheduled).toHaveBeenCalledTimes(2);
    expect(acc.start).not.toHaveBeenCalled();
    expect(player.state).toBe('playing');
  });

  it('반주가 null이면 합성음만 예약한다', async () => {
    const { engine, player } = setup({ withAcc: false });
    await player.play(plan, base);
    expect(engine.triggerScheduled).toHaveBeenCalledTimes(2);
  });

  it('반주 URL이 없으면 load·start를 부르지 않는다', async () => {
    const { acc, player } = setup();
    await player.play(plan, { ...base, accompanimentUrl: null });
    expect(acc.load).not.toHaveBeenCalled();
    expect(acc.start).not.toHaveBeenCalled();
  });

  it('재생 중 play를 다시 부르면 이전 핸들을 취소한다', async () => {
    const { cancels, player } = setup();
    await player.play(plan, base);
    await player.play(plan, base);
    expect(cancels).toHaveLength(4);
    expect(cancels[0]).toHaveBeenCalledTimes(1);
    expect(cancels[1]).toHaveBeenCalledTimes(1);
    expect(cancels[2]).not.toHaveBeenCalled();
  });

  it('ensure가 실패해도 던지지 않고 idle', async () => {
    const { engine, player } = setup();
    engine.ensure.mockRejectedValueOnce(new Error('x'));
    await expect(player.play(plan, base)).resolves.toBeUndefined();
    expect(player.state).toBe('idle');
  });

  it('준비 중 stop()하면 예약하지 않는다', async () => {
    const { engine, player } = setup();
    const p = player.play(plan, base);
    player.stop();
    await p;
    expect(engine.triggerScheduled).not.toHaveBeenCalled();
    expect(player.state).toBe('idle');
  });
});
