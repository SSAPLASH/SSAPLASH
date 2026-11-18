// 박자 맞추기가 출력 지연이 클 때도 클릭을 늦지 않게·고르게 예약하고, 결과값이 맞는지(설계 MODE-001 "같은 원인의 나머지 예약 경로").
// 모의 엔진: 화면 시계 시각 w에 들리게 하려는 클릭은 w가 now + 앞선 정도보다 이르면 now + 앞선 정도로 당겨진다(AudioEngine.click과 같은 동작).
import { describe, expect, it } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import { timingCalBeatMs } from '@/domain/kit/calibration/timingCalibration';
import { TIMING_CAL_TOTAL_BEATS, TimingCalSession } from './timingCalSession';

const BEAT = timingCalBeatMs();

function setup(ahead: number, useAhead = true) {
  let now = 1000;
  let tickFn: (() => void) | null = null;
  const asked: number[] = [];
  const heard: number[] = [];
  const s = new TimingCalSession();
  s.bind({
    click: (at) => {
      asked.push(at);
      const h = Math.max(at, now + ahead);
      heard.push(h);
      return h;
    },
    ensureAudio: async () => {},
    playHit: () => {},
    stopMetronome: () => {},
    busy: () => false,
    outputLatencyMs: () => ahead,
    kickConnected: () => false,
    now: () => now,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => {
      tickFn = null;
    },
    ...(useAhead ? { renderAheadMs: () => ahead } : {}),
  });
  const advanceTo = (to: number, onStep?: (t: number) => void) => {
    while (now < to) {
      now = Math.min(to, now + 25);
      onStep?.(now);
      (tickFn as (() => void) | null)?.();
    }
  };
  return { s, asked, heard, advanceTo };
}

const hit = (tHit: number): ResolvedHit =>
  ({ id: 1, pad: 'SNARE', velocity: 100, tHit, tRecv: tHit, source: 'serial', stickId: 0 }) as ResolvedHit;

describe('TimingCalSession 출력 지연', () => {
  it.each([0, 40, 120, 450, 800])('앞선 정도 %ims: 16박이 하나도 늦지 않고 간격이 정확히 600ms', async (ms) => {
    const t = setup(ms);
    await t.s.start();
    t.advanceTo(1000 + 400 + ms + 17 * BEAT);
    expect(t.heard).toHaveLength(TIMING_CAL_TOTAL_BEATS);
    t.heard.forEach((h, i) => expect(h).toBeCloseTo(t.asked[i], 9));
    t.heard.slice(1).forEach((h, i) => expect(h - t.heard[i]).toBeCloseTo(BEAT, 9));
  });

  it('앞선 정도를 안 더하면(예전) 450ms에서 클릭이 늦게 울린다', async () => {
    const t = setup(450, false);
    await t.s.start();
    t.advanceTo(1000 + 400 + 17 * BEAT);
    expect(Math.min(...t.heard.map((h, i) => h - t.asked[i]))).toBeGreaterThan(300);
  });

  it('앞선 정도 450ms에서 클릭보다 65ms 일찍 치면 결과가 −65ms', async () => {
    const t = setup(450);
    await t.s.start();
    let next = 4;
    t.advanceTo(1000 + 400 + 450 + 17 * BEAT + 400, (now) => {
      // 들리는 클릭 시각 기준으로 65ms 일찍 친다
      while (next < TIMING_CAL_TOTAL_BEATS && t.heard[next] !== undefined && t.heard[next] - 65 <= now) {
        t.s.intercept(hit(t.heard[next] - 65));
        next++;
      }
    });
    const snap = t.s.snapshot();
    expect(snap.phase).toBe('result');
    expect(snap.outcome?.stick).toMatchObject({ status: 'ok', offsetMs: -65 });
  });
});
