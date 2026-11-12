// yawAuto 진단 줄 검증: 10초 주기, 곡 시작 직후 1회, 값이 바뀔 때, 구독자 없으면 발행 안 함.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { diagSessionEnd, diagSessionStart } from '@/engine/diagReport';
import { RhythmSession } from '@/engine/RhythmSession';
import type { Chart } from '@/domain/chart';
import { startYawAutoDiag, YAW_AUTO_DIAG_INTERVAL_MS, type YawAutoDiag } from './yawAutoDiag';

const chart = { songId: 's', title: 't', bpm: 120, beatsPerBar: 4, notes: [{ timeMs: 0, pad: 'SNARE' }] } as Chart;
const windows = { perfectMs: 25, goodMs: 60 };
const startSong = () =>
  diagSessionStart(new RhythmSession(chart, { windows, countInBars: 0, audioOffsetMs: 0, kickOffsetMs: 0 }), 'RHYTHM', { windows, audioOffsetMs: 0, kickOffsetMs: 0 });

let diag: YawAutoDiag | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  diag?.stop();
  diag = null;
  diagSessionEnd('left');
  vi.useRealTimers();
});

const listen = () => {
  const got: DiagEvent[] = [];
  const off = diagTap.subscribe((e) => got.push(e));
  return { got, off };
};
const yawAutoOf = (got: DiagEvent[]) => got.filter((e) => e.type === 'yawAuto');

describe('yawAuto 진단 줄', () => {
  it('곡 시작 직후 지금 값을 1회 낸다', () => {
    const { got, off } = listen();
    let on = false;
    diag = startYawAutoDiag(() => on);
    on = true;
    startSong();
    expect(yawAutoOf(got)).toEqual([expect.objectContaining({ type: 'yawAuto', on: true })]);
    expect(got[0].type).toBe('session');
    off();
  });

  it('값이 바뀔 때만 낸다', () => {
    const { got, off } = listen();
    let on = false;
    diag = startYawAutoDiag(() => on);
    diag.sync();
    expect(yawAutoOf(got)).toHaveLength(0);
    on = true;
    diag.sync();
    diag.sync();
    on = false;
    diag.sync();
    expect(yawAutoOf(got).map((e) => (e as { on: boolean }).on)).toEqual([true, false]);
    off();
  });

  it('10초마다 지금 값을 낸다(녹화를 곡 시작 뒤에 켜도 남는다)', () => {
    const { got, off } = listen();
    let on = false;
    diag = startYawAutoDiag(() => on);
    vi.advanceTimersByTime(YAW_AUTO_DIAG_INTERVAL_MS - 1);
    expect(yawAutoOf(got)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    on = true;
    vi.advanceTimersByTime(YAW_AUTO_DIAG_INTERVAL_MS);
    expect(yawAutoOf(got).map((e) => (e as { on: boolean }).on)).toEqual([false, true]);
    // 주기로 이미 알린 값은 sync가 다시 내지 않는다
    diag.sync();
    expect(yawAutoOf(got)).toHaveLength(2);
    off();
  });

  it('구독자가 없으면 내지 않고, 해제하면 주기·곡 시작에도 내지 않는다', () => {
    let on = false;
    diag = startYawAutoDiag(() => on);
    on = true;
    diag.sync();
    const { got, off } = listen();
    diag.stop();
    startSong();
    vi.advanceTimersByTime(YAW_AUTO_DIAG_INTERVAL_MS * 2);
    expect(yawAutoOf(got)).toHaveLength(0);
    off();
  });
});
