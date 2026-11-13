// 채보 자동 재생을 오디오 시계 기준 연주 시계에 붙였을 때(설계 MODE-001): 출력 지연·일시정지·재개·다시 시작·오디오 멈춤에서
// 노트 소리가 늦지 않고 반주(ctxZero + 곡 시각)와 같은 오디오 시각에 놓이는지.
// 모의 오디오: currentTime은 화면 시계와 같이 흐르되 멈춤 구간이 있고, 들리는 시각 = currentTime − 출력 지연.
// 화면 시계 시각 at에 들리게 하려는 소리의 오디오 시각 = 들리는 시각 변환, 그게 currentTime보다 이르면 늦음.
import { describe, expect, it } from 'vitest';
import { PlayClock, type ClockAccompaniment } from '@/features/play/sessionClock';
import { RhythmSession } from '@/engine/RhythmSession';
import { createChartAutoplay } from './chartAutoplay';
import type { AudioReading } from '@/domain/time/audioTimeline';
import type { Chart } from '@/domain/song/chart';

const NOTES = Array.from({ length: 160 }, (_, i) => ({ timeMs: i * 125, pad: 'SNARE' as const }));

function setup(latency: number, stall?: [number, number]) {
  let now = 1000;
  const ctxAt = (p: number) => {
    const stalled = stall ? Math.max(0, Math.min(p, stall[1]) - stall[0]) : 0;
    return 5 + (p - 1000 - stalled) / 1000;
  };
  // 들리는 시각 = currentTime − 지연. 화면 시계 → 들리는 오디오 시각 변환(엔진 perfToContextTime과 같은 뜻)
  const heardOf = (p: number) => ctxAt(p) - latency;
  const perfToHeardCtx = (at: number) => heardOf(now) + (at - now) / 1000;
  const reading = (): AudioReading => ({ perfMs: now, ctxSec: ctxAt(now), heardCtxSec: heardOf(now) });
  const chart: Chart = { songId: 't', title: 't', difficulty: 'EASY', bpm: 120, offsetMs: 0, beatsPerBar: 4, notes: NOTES, source: 'BUILTIN', durationMs: 25_000 };
  const session = new RhythmSession(chart, { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0, kickOffsetMs: 0 });
  const acc: ClockAccompaniment = { start() {}, startAtContext() {}, pause: () => 0, resume() {}, stop() {} };
  const timers: Array<() => void> = [];
  const clock = new PlayClock(session, {
    click: () => null,
    clickAt: (c) => c,
    audioReading: reading,
    accompaniment: acc,
    clickOn: () => false,
    now: () => now,
    setInterval: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval: () => {},
    visibility: () => 'visible',
    onVisibilityChange: () => () => {},
  });
  const played: Array<{ want: number; cur: number; zero: number; note: number }> = [];
  const zero = () => clock.contextZero as number;
  const ap = createChartAutoplay({
    notes: NOTES,
    songTime: () => (clock.state.phase === 'running' ? clock.songTime(now) : null),
    play: (_p, _v, at) => {
      played.push({ want: perfToHeardCtx(at), cur: ctxAt(now), zero: zero(), note: NaN });
    },
    now: () => now,
    setInterval: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval: () => {},
    visibility: () => 'visible',
    renderAheadMs: () => (ctxAt(now) - heardOf(now)) * 1000,
    songToContext: (s) => clock.songTimeToContext(s),
    contextNow: () => ctxAt(now),
    playAtContext: (_p, _v, c) => {
      played.push({ want: c, cur: ctxAt(now), zero: zero(), note: NaN });
    },
    onVisibilityChange: () => () => {},
  });
  return {
    clock,
    ap,
    played,
    run(to: number) {
      for (let t = now; t <= to; t += 5) {
        now = t;
        if (t % 25 === 0) for (const f of timers) f();
        if (t % 15 === 0) clock.onFrame(t);
      }
    },
    get now() {
      return now;
    },
  };
}

/** 소리마다 늦음(ms)과, 반주 기준(ctxZero + 곡 시각)에서 가장 가까운 노트까지 차이(ms) */
function check(played: Array<{ want: number; cur: number; zero: number }>) {
  return played.map((p) => {
    const at = Math.max(p.want, p.cur);
    let best = Infinity;
    for (const n of NOTES) {
      const d = (at - (p.zero + n.timeMs / 1000)) * 1000;
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    return { late: Math.max(0, (p.cur - p.want) * 1000), err: best };
  });
}

describe('채보 자동 재생 + 오디오 시계 기준 연주 시계', () => {
  it.each([0.05, 0.5, 1.2])('출력 지연 %f초: 일시정지·재개 앞뒤 모든 노트가 늦지 않고 반주 기준과 같은 오디오 시각', (lat) => {
    const s = setup(lat);
    s.clock.begin();
    s.ap.start();
    s.run(1000 + 11_000);
    s.clock.pause('t');
    s.run(1000 + 13_000);
    s.clock.resume();
    s.run(1000 + 22_000);
    const r = check(s.played);
    expect(r.length).toBeGreaterThan(60);
    for (const x of r) {
      expect(x.late).toBe(0);
      expect(Math.abs(x.err)).toBeLessThan(1e-6);
    }
  });

  it('다시 시작해도 노트가 늦지 않고 새 기준에 맞는다(출력 지연 0.5초)', () => {
    const s = setup(0.5);
    s.clock.begin();
    s.ap.start();
    s.run(1000 + 10_000);
    s.clock.restart();
    s.run(1000 + 20_000);
    for (const x of check(s.played)) {
      expect(x.late).toBe(0);
      expect(Math.abs(x.err)).toBeLessThan(1e-6);
    }
  });

  it('오디오 시계가 1.5초 멈춰도 노트가 늦거나 반주와 어긋나지 않는다(출력 지연 0.5초)', () => {
    const s = setup(0.5, [1000 + 12_000, 1000 + 13_500]);
    s.clock.begin();
    s.ap.start();
    s.run(1000 + 20_000);
    for (const x of check(s.played)) {
      expect(x.late).toBe(0);
      expect(Math.abs(x.err)).toBeLessThan(1e-6);
    }
  });
});
