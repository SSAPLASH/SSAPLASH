// PlayClock 오디오 시계 기준 연주 검증(설계 MODE-001 연주 시계를 오디오 시계 하나로).
// 모의 오디오 시계: currentTime은 화면 시계와 같은 빠르기로 흐르되 멈춤 구간이 있고, 들리는 시각은 currentTime − 출력 지연(시간에 따라 커짐).
import { describe, expect, it } from 'vitest';
import { PlayClock, type ClockAccompaniment } from './sessionClock';
import { RhythmSession } from '@/engine/RhythmSession';
import { beatTimeMs } from '@/domain/time/tempo';
import type { AudioReading } from '@/domain/time/audioTimeline';
import type { Chart } from '@/domain/song/chart';
import type { ClickLevel, Subdivision } from '@/domain/time/metronome';

function makeChart(durationMs: number, noteEveryMs = 0): Chart {
  const notes = [];
  if (noteEveryMs > 0) for (let t = 0; t < durationMs; t += noteEveryMs) notes.push({ timeMs: t, pad: 'SNARE' as const });
  return {
    songId: 't',
    title: '테스트',
    difficulty: 'EASY',
    bpm: 120,
    offsetMs: 0,
    beatsPerBar: 4,
    notes,
    source: 'BUILTIN',
    durationMs,
  };
}

interface Opts {
  durationMs?: number;
  noteEveryMs?: number;
  /** perf(ms) → 출력 지연(초) */
  latency?: (perf: number) => number;
  /** 오디오 시계가 멈추는 화면 시계 구간 [시작, 끝) */
  stall?: [number, number];
  /** 멈춤 동안 들리는 시각이 화면 시계로 이어 셈해 계속 흐르는지(실제 getOutputTimestamp처럼 갱신이 멈춘 경우) */
  heardRunsOnInStall?: boolean;
  /** 이 화면 시계 구간 동안 컨텍스트가 suspended라 읽기 값이 없음(멈춤 구간과 같이 줌) */
  suspended?: boolean;
  /** 탭이 가려진 화면 시계 구간 [시작, 끝). 이 동안 박 타이머가 1초에 한 번만 돈다(브라우저 타이머 제한) */
  hidden?: [number, number];
  /** 박 분할(없으면 4분) */
  subdivision?: Subdivision;
}

function setup(o: Opts = {}) {
  let now = 1000;
  const latency = o.latency ?? (() => 0.08);
  const ctxAt = (p: number) => {
    // 화면 시계 1000ms = 오디오 시계 5초에서 시작, 멈춤 구간만큼 덜 흐름
    let stalled = 0;
    if (o.stall) stalled = Math.max(0, Math.min(p, o.stall[1]) - o.stall[0]);
    return 5 + (p - 1000 - stalled) / 1000;
  };
  const heardAt = (p: number) => {
    if (o.heardRunsOnInStall && o.stall && p >= o.stall[0] && p < o.stall[1]) {
      return ctxAt(o.stall[0]) - latency(o.stall[0]) + (p - o.stall[0]) / 1000;
    }
    return ctxAt(p) - latency(p);
  };
  const reading = (): AudioReading | null => {
    if (o.suspended && o.stall && now >= o.stall[0] && now < o.stall[1]) return null;
    return { perfMs: now, ctxSec: ctxAt(now), heardCtxSec: heardAt(now) };
  };
  const clicks: Array<{ at: number; nowCtx: number; level: ClickLevel }> = [];
  const accStarts: Array<{ ctx: number; from: number; nowCtx: number }> = [];
  const accompaniment: ClockAccompaniment = {
    start() {
      throw new Error('오디오 시계 기준에서는 화면 시계 start를 쓰지 않음');
    },
    startAtContext(ctx, from) {
      accStarts.push({ ctx, from, nowCtx: ctxAt(now) });
    },
    pause: () => 0,
    resume() {},
    stop() {},
  };
  const session = new RhythmSession(makeChart(o.durationMs ?? 120_000, o.noteEveryMs ?? 0), {
    windows: { perfectMs: 25, goodMs: 60 },
    countInBars: 1,
    audioOffsetMs: 0, kickOffsetMs: 0,
  });
  let tickFn: (() => void) | null = null;
  let visFn: (() => void) | null = null;
  const clock = new PlayClock(session, {
    onVisibilityChange: (fn) => {
      visFn = fn;
      return () => {
        visFn = null;
      };
    },
    click: () => {
      throw new Error('오디오 시계 기준에서는 화면 시계 click을 쓰지 않음');
    },
    clickAt: (ctx, level) => {
      clicks.push({ at: ctx, nowCtx: ctxAt(now), level });
      return ctx;
    },
    subdivision: o.subdivision ? () => o.subdivision as Subdivision : undefined,
    audioReading: reading,
    accompaniment,
    clickOn: () => true,
    now: () => now,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => {
      tickFn = null;
    },
    visibility: () => (o.hidden && now >= o.hidden[0] && now < o.hidden[1] ? 'hidden' : 'visible'),
  });
  const isHidden = (t: number) => !!o.hidden && t >= o.hidden[0] && t < o.hidden[1];
  return {
    clock,
    session,
    clicks,
    accStarts,
    /** from부터 to까지 5ms씩: 25ms마다 박 타이머, 15ms마다 프레임. onFrame은 프레임 직후(화면이 곡 시각을 읽는 시점)에 부른다 */
    run(to: number, onFrame?: (t: number) => void) {
      for (let t = now; t <= to; t += 5) {
        now = t;
        // 가려지는 순간 visibilitychange, 그 뒤 타이머는 1초에 한 번
        if (o.hidden && t === o.hidden[0]) visFn?.();
        if (isHidden(t) ? (t - (o.hidden?.[0] ?? 0)) % 1000 === 995 : t % 25 === 0) tickFn?.();
        if (!isHidden(t) && t % 15 === 0) clock.onFrame(t);
        // 곡 시각은 프레임 사이 아무 때나 읽혀도(채보 자동 재생·타격 판정) 줄면 안 되므로 5ms마다 확인한다
        onFrame?.(t);
      }
    },
    get now() {
      return now;
    },
  };
}

describe('PlayClock 오디오 시계 기준', () => {
  it('출력 지연이 0.08초에서 0.8초로 커져도 모든 클릭이 ctxZero + 박 시각에 예약되고 지난 시각으로 당겨지지 않는다', () => {
    const s = setup({ latency: (p) => 0.08 + Math.min(0.72, ((p - 1000) / 60_000) * 0.72) });
    s.clock.begin();
    s.run(1000 + 70_000);
    const zero = s.accStarts[0].ctx;
    expect(s.accStarts[0].from).toBe(0);
    const countIn = Math.round(s.session.countInMs / s.session.beatMs);
    expect(s.clicks.length).toBeGreaterThan(120);
    s.clicks.forEach((c, i) => {
      expect(c.at).toBeCloseTo(zero + beatTimeMs(s.session.chart, i - countIn) / 1000, 9);
      expect(c.at).toBeGreaterThanOrEqual(c.nowCtx);
    });
  });

  it('탭이 가려져 박 타이머가 1초에 한 번만 돌아도 출력 지연 0.6초에서 클릭을 놓치거나 늦지 않는다', () => {
    // 가려지는 시각을 타이머 칸과 어긋나게 둠
    const hidden: [number, number] = [1000 + 12_510, 1000 + 30_510];
    const s = setup({ latency: () => 0.6, hidden });
    s.clock.begin();
    s.run(1000 + 40_000);
    const zero = s.accStarts[0].ctx;
    const countIn = Math.round(s.session.countInMs / s.session.beatMs);
    // 박 하나도 빠지지 않음: 클릭 수 = 마지막 클릭까지의 박 수
    const lastSong = (s.clicks.at(-1)!.at - zero) * 1000;
    const expected = Math.round(lastSong / s.session.beatMs) + countIn + 1;
    expect(s.clicks).toHaveLength(expected);
    s.clicks.forEach((c, i) => {
      expect(c.at).toBeCloseTo(zero + beatTimeMs(s.session.chart, i - countIn) / 1000, 9);
      expect(c.at).toBeGreaterThanOrEqual(c.nowCtx);
    });
  });

  it('곡 시각은 들리는 오디오 시각을 따른다(출력 지연만큼 늦게 들림)', () => {
    const s = setup({ latency: () => 0.5 });
    s.clock.begin();
    s.run(1000 + 10_000);
    const zero = s.accStarts[0].ctx;
    // 지금 들리는 오디오 시각 − ctxZero
    const heard = 5 + (s.now - 1000) / 1000 - 0.5;
    expect(s.session.songTime(s.now)).toBeCloseTo((heard - zero) * 1000, 3);
  });

  it('곡 도중 오디오 시계가 1.5초 멈추면 곡 시각도 멈추고 그동안 MISS가 늘지 않는다', () => {
    const stall: [number, number] = [1000 + 15_000, 1000 + 16_500];
    const s = setup({ stall, noteEveryMs: 100 });
    s.clock.begin();
    let prev = -Infinity;
    let missAtStall = -1;
    let missBeforeEnd = -1;
    let songAtStall = 0;
    s.run(1000 + 25_000, (t) => {
      const song = s.session.songTime(t);
      expect(song).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = song;
      if (t >= stall[0] + 100 && missAtStall < 0) {
        missAtStall = s.session.snapshot(t).counts.MISS;
        songAtStall = song;
      }
      if (t >= stall[0] + 100 && t < stall[1]) {
        missBeforeEnd = s.session.snapshot(t).counts.MISS;
        // 멈춤 동안 곡 시각이 거의 안 흐름(멈춤 직후 프레임 한 칸 안)
        expect(song - songAtStall).toBeLessThan(20);
      }
    });
    expect(missAtStall).toBeGreaterThan(0);
    expect(missBeforeEnd).toBe(missAtStall);
    // 멈춤 뒤 클릭도 여전히 ctxZero + 박 시각
    const zero = s.accStarts[0].ctx;
    const countIn = Math.round(s.session.countInMs / s.session.beatMs);
    s.clicks.forEach((c, i) => expect(c.at).toBeCloseTo(zero + beatTimeMs(s.session.chart, i - countIn) / 1000, 9));
  });

  it('멈춤 동안 출력 시각이 계속 흐르는 것처럼 보여도 currentTime이 멈췄으면 곡 시각을 멈춘다', () => {
    const stall: [number, number] = [1000 + 15_000, 1000 + 16_500];
    const s = setup({ stall, noteEveryMs: 100, heardRunsOnInStall: true });
    s.clock.begin();
    let prev = -Infinity;
    let missAtStall = -1;
    let missBeforeEnd = -1;
    let songAtStall = 0;
    s.run(1000 + 25_000, (t) => {
      const song = s.session.songTime(t);
      expect(song).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = song;
      if (t >= stall[0] + 100 && missAtStall < 0) {
        missAtStall = s.session.snapshot(t).counts.MISS;
        songAtStall = song;
      }
      if (t >= stall[0] + 100 && t < stall[1]) {
        missBeforeEnd = s.session.snapshot(t).counts.MISS;
        // 멈춤 동안 곡 시각이 거의 안 흐름(멈춤 직후 프레임 한 칸 안)
        expect(song - songAtStall).toBeLessThan(20);
      }
    });
    expect(missAtStall).toBeGreaterThan(0);
    expect(missBeforeEnd).toBe(missAtStall);
    // 멈춤 뒤 클릭도 여전히 ctxZero + 박 시각
    const zero = s.accStarts[0].ctx;
    const countIn = Math.round(s.session.countInMs / s.session.beatMs);
    s.clicks.forEach((c, i) => expect(c.at).toBeCloseTo(zero + beatTimeMs(s.session.chart, i - countIn) / 1000, 9));
  });

  it('컨텍스트가 suspended라 읽기 값이 없는 동안 곡 시각을 멈추고 다시 흘러도 뒤로 돌아가지 않는다', () => {
    const stall: [number, number] = [1000 + 15_000, 1000 + 16_500];
    const s = setup({ stall, noteEveryMs: 100, suspended: true });
    s.clock.begin();
    let prev = -Infinity;
    let missAtStall = -1;
    let missBeforeEnd = -1;
    let songAtStall = 0;
    s.run(1000 + 25_000, (t) => {
      const song = s.session.songTime(t);
      expect(song).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = song;
      if (t >= stall[0] + 100 && missAtStall < 0) {
        missAtStall = s.session.snapshot(t).counts.MISS;
        songAtStall = song;
      }
      if (t >= stall[0] + 100 && t < stall[1]) {
        missBeforeEnd = s.session.snapshot(t).counts.MISS;
        // 멈춤 동안 곡 시각이 거의 안 흐름(멈춤 직후 프레임 한 칸 안)
        expect(song - songAtStall).toBeLessThan(20);
      }
    });
    expect(missAtStall).toBeGreaterThan(0);
    expect(missBeforeEnd).toBe(missAtStall);
    // 멈춤 뒤 클릭도 여전히 ctxZero + 박 시각
    const zero = s.accStarts[0].ctx;
    const countIn = Math.round(s.session.countInMs / s.session.beatMs);
    s.clicks.forEach((c, i) => expect(c.at).toBeCloseTo(zero + beatTimeMs(s.session.chart, i - countIn) / 1000, 9));
  });

  it('일시정지·재개: 반주를 멈춘 곡 시각부터 0.05초 뒤 오디오 시계에 다시 예약하고 곡 시각이 줄지 않는다', () => {
    const s = setup({ latency: () => 0.3 });
    s.clock.begin();
    s.run(1000 + 8_000);
    s.clock.pause('test');
    const paused = s.session.songTime(s.now);
    s.run(1000 + 12_000);
    expect(s.session.songTime(s.now)).toBe(paused);
    s.clock.resume();
    const re = s.accStarts.at(-1)!;
    expect(re.from).toBeCloseTo(paused, 6);
    expect(re.ctx).toBeCloseTo(re.nowCtx + 0.05, 6);
    let prev = paused;
    s.run(1000 + 20_000, (t) => {
      const song = s.session.songTime(t);
      expect(song).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = song;
    });
    // 재개 뒤 클릭은 새 기준(re.ctx − 멈춘 곡 시각)으로 박 시각에 맞음
    const zero2 = re.ctx - paused / 1000;
    const countIn = Math.round(s.session.countInMs / s.session.beatMs);
    const after = s.clicks.filter((c) => c.at > re.ctx);
    expect(after.length).toBeGreaterThan(10);
    for (const c of after) {
      const song = (c.at - zero2) * 1000;
      const i = Math.round(song / s.session.beatMs) + countIn;
      expect(song).toBeCloseTo(beatTimeMs(s.session.chart, i - countIn), 6);
    }
  });

  it('8분: 사이 박도 반주와 같은 오디오 시계(ctxZero + 반 박 시각)에 예약되고 탭이 가려져도 빠지지 않는다', () => {
    const hidden: [number, number] = [1000 + 12_510, 1000 + 20_510];
    const s = setup({ latency: () => 0.6, hidden, subdivision: 2 });
    s.clock.begin();
    s.run(1000 + 30_000);
    const zero = s.accStarts[0].ctx;
    const countIn = Math.round(s.session.countInMs / s.session.beatMs);
    expect(s.clicks.length).toBeGreaterThan(80);
    s.clicks.forEach((c, i) => {
      expect(c.at).toBeCloseTo(zero + beatTimeMs(s.session.chart, i / 2 - countIn) / 1000, 9);
      expect(c.at).toBeGreaterThanOrEqual(c.nowCtx);
      expect(c.level === 'sub').toBe(i % 2 === 1);
    });
  });

  it('audioReading이 없으면 예전 화면 시계 방식으로 돈다', () => {
    let now = 1000;
    const timer: { fn: (() => void) | null } = { fn: null };
    const session = new RhythmSession(makeChart(60_000), { windows: { perfectMs: 25, goodMs: 60 }, countInBars: 1, audioOffsetMs: 0, kickOffsetMs: 0 });
    const perfClicks: number[] = [];
    const clock = new PlayClock(session, {
      click: (at) => {
        perfClicks.push(at);
        return at;
      },
      clickAt: () => {
        throw new Error('audioReading이 없으면 쓰지 않음');
      },
      clickOn: () => true,
      now: () => now,
      setInterval: (fn) => {
        timer.fn = fn;
        return 1;
      },
      clearInterval: () => {},
      visibility: () => 'visible',
    });
    clock.begin();
    for (now = 1000; now < 12_000; now += 25) timer.fn?.();
    expect(perfClicks.length).toBeGreaterThan(4);
  });
});
