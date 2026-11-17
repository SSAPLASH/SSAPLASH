// PlayClock의 accDrift 발행 검증(T2). 오디오 시계를 1.0001배속으로 흘린 모의 반주를 쓴다.
import { afterEach, describe, expect, it } from 'vitest';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { PlayClock, ACC_DRIFT_INTERVAL_MS, type ClockAccompaniment } from './sessionClock';
import { RhythmSession } from '@/engine/RhythmSession';
import type { Chart } from '@/domain/song/chart';

function makeSession(durationMs: number): RhythmSession {
  const chart: Chart = {
    songId: 't',
    title: '테스트',
    difficulty: 'EASY',
    bpm: 120,
    offsetMs: 0,
    beatsPerBar: 4,
    notes: [],
    source: 'BUILTIN',
    durationMs,
  };
  return new RhythmSession(chart, { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0, kickOffsetMs: 0 });
}

function setup(audioRate: number | null) {
  let now = 1000;
  let zero = 0;
  let playing = false;
  const accompaniment: ClockAccompaniment = {
    start(at, from) {
      zero = at - from;
      playing = true;
    },
    pause: () => 0,
    resume() {},
    stop() {
      playing = false;
    },
    ...(audioRate === null ? {} : { audioPositionAt: (p: number) => (playing && p >= zero ? (p - zero) * audioRate : null) }),
  };
  let tickFn: (() => void) | null = null;
  const clock = new PlayClock(makeSession(20 * 60_000), {
    click: (at) => at,
    accompaniment,
    clickOn: () => false,
    now: () => now,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => {
      tickFn = null;
    },
    visibility: () => 'visible',
  });
  return {
    clock,
    tick(n: number) {
      now = n;
      tickFn?.();
    },
  };
}

const events: DiagEvent[] = [];
let unsub: (() => void) | null = null;
afterEach(() => {
  unsub?.();
  unsub = null;
  events.length = 0;
});
function listen() {
  unsub = diagTap.subscribe((ev) => {
    if (ev.type === 'accDrift') events.push(ev);
  });
}
function drifts() {
  return events.flatMap((e) => (e.type === 'accDrift' ? [{ song: e.songTimeMs, drift: e.driftMs, pos: e.audioPosMs }] : []));
}

describe('PlayClock accDrift', () => {
  it('오디오 시계가 1.0001배속이면 드리프트가 분당 약 6ms씩 커진다', () => {
    listen();
    const t = setup(1.0001);
    t.clock.begin();
    // 반주 0초 = 6300. 25ms 타이머로 3분 진행
    for (let n = 1025; n <= 6300 + 180_000; n += 25) t.tick(n);
    const d = drifts();
    expect(d.length).toBeGreaterThan(300);
    const last = d[d.length - 1];
    expect(last.song).toBeGreaterThan(179_000);
    expect(last.drift).toBeCloseTo(last.song * 0.0001, 3);
    const at60 = d.find((x) => x.song >= 60_000);
    expect(at60?.drift).toBeGreaterThan(5.9);
    expect(at60?.drift).toBeLessThan(6.1);
    expect(last.pos).toBeCloseTo(last.song + last.drift, 6);
  });

  it('500ms마다 한 번만 발행하고, 반주가 아직 울리기 전(카운트인 초반)에는 발행하지 않는다', () => {
    listen();
    const t = setup(1);
    t.clock.begin();
    for (let n = 1025; n < 6300; n += 25) t.tick(n);
    expect(drifts()).toHaveLength(0);
    for (let n = 6300; n <= 6300 + 5000; n += 25) t.tick(n);
    expect(drifts().length).toBe(Math.floor(5000 / ACC_DRIFT_INTERVAL_MS) + 1);
    for (const x of drifts()) expect(Math.abs(x.drift)).toBeLessThan(1e-9);
  });

  it('구독자가 없거나 audioPositionAt이 없는 반주면 발행하지 않는다', () => {
    const t = setup(1);
    t.clock.begin();
    for (let n = 1025; n < 11000; n += 25) t.tick(n);
    expect(events).toHaveLength(0);
    listen();
    const u = setup(null);
    u.clock.begin();
    for (let n = 1025; n < 11000; n += 25) u.tick(n);
    expect(events).toHaveLength(0);
  });
});
