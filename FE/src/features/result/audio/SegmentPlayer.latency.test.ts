// 구간 재생이 출력 지연이 클 때도 첫 소리부터 늦지 않게 예약하는지(설계 MODE-001 "같은 원인의 나머지 예약 경로").
// 모의 엔진: 화면 시계 시각 at에 들리게 하려는 소리는 at이 now + 앞선 정도보다 이르면 now + 앞선 정도로 당겨진다(AudioEngine.fire와 같은 동작).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEGMENT_LOOP_GAP_MS, type SegmentPlan } from '@/features/result/domain/segmentPlayback';
import { SEGMENT_START_LEAD_MS, SegmentPlayer } from './SegmentPlayer';

const NOW = 10_000;
const plan: SegmentPlan = {
  events: Array.from({ length: 16 }, (_, i) => ({ atMs: i * 125, pad: i % 2 ? 'HIHAT' : 'KICK', velocity: 90 }) as const),
  lengthMs: 2000,
  fromMs: 4000,
  toMs: 6000,
};

function setup(ahead: number, useAhead = true) {
  const asked: number[] = [];
  const heard: number[] = [];
  const engine = {
    ensure: vi.fn(async () => ({}) as AudioContext),
    triggerScheduled: vi.fn((_p: string, _v: number, at: number) => {
      asked.push(at);
      heard.push(Math.max(at, NOW + ahead));
      return { at, cancel: vi.fn() };
    }),
    ...(useAhead ? { renderAheadMs: () => ahead } : {}),
  };
  const acc = { load: vi.fn(async () => {}), start: vi.fn(), stop: vi.fn(), setRate: vi.fn() };
  const player = new SegmentPlayer(engine as never, acc, { now: () => NOW });
  return { player, asked, heard, acc };
}

describe('SegmentPlayer 출력 지연', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([0, 40, 250, 450, 800])('앞선 정도 %ims: 모든 소리가 늦지 않고 반주와 같은 시작 시각 기준', async (ms) => {
    const t = setup(ms);
    await t.player.play(plan, { rate: 1, loop: false, accompanimentUrl: 'https://x/a.mp3' });
    const start = NOW + SEGMENT_START_LEAD_MS + ms;
    t.heard.forEach((h, i) => {
      expect(h).toBeCloseTo(t.asked[i], 9);
      expect(h).toBeCloseTo(start + plan.events[i].atMs, 9);
    });
    expect(t.acc.start).toHaveBeenCalledWith(start, 4000);
    // 반주 정지와 끝 알림도 같은 여유만큼 뒤
    t.acc.stop.mockClear();
    vi.advanceTimersByTime(SEGMENT_START_LEAD_MS + ms + plan.lengthMs - 1);
    expect(t.acc.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(t.acc.stop).toHaveBeenCalled();
    vi.advanceTimersByTime(SEGMENT_LOOP_GAP_MS);
    expect(t.player.state).toBe('idle');
  });

  it('앞선 정도를 안 더하면(예전) 450ms에서 첫 소리들이 늦게 들린다', async () => {
    const t = setup(450, false);
    await t.player.play(plan, { rate: 1, loop: false, accompanimentUrl: null });
    expect(t.heard[0] - t.asked[0]).toBeCloseTo(450 - SEGMENT_START_LEAD_MS, 9);
  });
});
