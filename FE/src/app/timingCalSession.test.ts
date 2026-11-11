// 박자 맞추기 진행 검증: 16박 예약, 단계 전환, 타격 가로채기(소리만), 결과 계산, 취소.
import { describe, expect, it } from 'vitest';
import { TimingCalSession, TIMING_CAL_TOTAL_BEATS, type TimingCalDeps } from './timingCalSession';
import { timingCalBeatMs, TIMING_CAL_LISTEN_BEATS } from '@/domain/timingCalibration';
import type { ResolvedHit } from '@/domain/events';

const BEAT = timingCalBeatMs();

function setup(over: Partial<TimingCalDeps> = {}) {
  let now = 1000;
  let tickFn: (() => void) | null = null;
  const clicks: { at: number; accent: boolean }[] = [];
  const played: ResolvedHit[] = [];
  let metronomeStops = 0;
  const s = new TimingCalSession();
  s.bind({
    click: (at, accent) => {
      clicks.push({ at, accent });
      return at;
    },
    ensureAudio: async () => {},
    playHit: (h) => played.push(h),
    stopMetronome: () => metronomeStops++,
    busy: () => false,
    outputLatencyMs: () => 42,
    now: () => now,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => {
      tickFn = null;
    },
    ...over,
  });
  /** 시계를 to까지 25ms씩 돌린다. onStep은 틱 직전에 불린다 */
  const advanceTo = (to: number, onStep?: (t: number) => void) => {
    while (now < to) {
      now = Math.min(to, now + 25);
      onStep?.(now);
      (tickFn as (() => void) | null)?.();
    }
  };
  return { s, clicks, played, advanceTo, now: () => now, stops: () => metronomeStops, ticking: () => tickFn !== null };
}

const hit = (tHit: number, over: Partial<ResolvedHit> = {}): ResolvedHit =>
  ({ id: 1, pad: 'SNARE', velocity: 100, tHit, tRecv: tHit, source: 'serial', stickId: 0, ...over }) as ResolvedHit;

describe('TimingCalSession', () => {
  it('시작하면 전역 메트로놈을 멈추고 16박을 600ms 간격으로 예약한다', async () => {
    const t = setup();
    expect(await t.s.start()).toBe(true);
    expect(t.stops()).toBe(1);
    expect(t.s.snapshot().phase).toBe('listen');
    t.advanceTo(1000 + 400 + 16 * BEAT);
    expect(t.clicks).toHaveLength(TIMING_CAL_TOTAL_BEATS);
    expect(t.clicks[1].at - t.clicks[0].at).toBe(BEAT);
    expect(t.clicks.map((c) => c.accent).slice(0, 5)).toEqual([true, false, false, false, true]);
  });

  it('듣기 4박이 지나면 측정 단계가 된다', async () => {
    const t = setup();
    await t.s.start();
    const first = 1400;
    t.advanceTo(first + 3 * BEAT + 10);
    expect(t.s.snapshot()).toMatchObject({ phase: 'listen', beat: 4 });
    t.advanceTo(first + 4 * BEAT + 10);
    expect(t.s.snapshot()).toMatchObject({ phase: 'measure', beat: 5 });
  });

  it('측정 박마다 65ms 일찍 치면 결과가 −65ms이고 타격은 소리만 난다', async () => {
    const t = setup();
    await t.s.start();
    const first = 1400;
    const targets = Array.from({ length: 12 }, (_, i) => first + (TIMING_CAL_LISTEN_BEATS + i) * BEAT - 65);
    let next = 0;
    t.advanceTo(first + 16 * BEAT + 400, (now) => {
      while (next < targets.length && targets[next] <= now) {
        expect(t.s.intercept(hit(targets[next]))).toBe(true);
        next++;
      }
    });
    const snap = t.s.snapshot();
    expect(snap.phase).toBe('result');
    expect(snap.result).toMatchObject({ status: 'ok', pairs: 12, offsetMs: -65, input: 'sensor' });
    expect(snap.outputLatencyMs).toBe(42);
    expect(t.played).toHaveLength(12);
    expect(t.ticking()).toBe(false);
    // 끝난 뒤 타격은 가로채지 않는다
    expect(t.s.intercept(hit(99_999))).toBe(false);
  });

  it('타격이 없으면 표본 부족으로 끝난다', async () => {
    const t = setup();
    await t.s.start();
    t.advanceTo(1400 + 16 * BEAT + 400);
    expect(t.s.snapshot().result).toMatchObject({ status: 'few', pairs: 0, offsetMs: null });
  });

  it('패드가 정해지지 않은 타격은 소리 없이 버린다', async () => {
    const t = setup();
    await t.s.start();
    expect(t.s.intercept(hit(1500, { pad: null }))).toBe(true);
    expect(t.played).toHaveLength(0);
  });

  it('진행 중이 아니면 타격을 가로채지 않는다', () => {
    const t = setup();
    expect(t.s.intercept(hit(1000))).toBe(false);
  });

  it('취소하면 예약을 멈추고 대기로 돌아가며 타격을 가로채지 않는다', async () => {
    const t = setup();
    await t.s.start();
    t.advanceTo(1400 + 2 * BEAT);
    const before = t.clicks.length;
    t.s.cancel();
    expect(t.s.snapshot().phase).toBe('idle');
    expect(t.ticking()).toBe(false);
    expect(t.s.intercept(hit(3000))).toBe(false);
    expect(t.clicks).toHaveLength(before);
  });

  it('패드 보정 중에는 시작하지 않는다', async () => {
    const t = setup({ busy: () => true });
    expect(await t.s.start()).toBe(false);
    expect(t.s.snapshot().phase).toBe('idle');
    expect(t.stops()).toBe(0);
  });

  it('오디오 준비를 기다리는 사이 취소하면 시작하지 않는다', async () => {
    let release: () => void = () => {};
    const t = setup({ ensureAudio: () => new Promise<void>((r) => (release = r)) });
    const p = t.s.start();
    expect(t.s.snapshot().phase).toBe('starting');
    t.s.cancel();
    release();
    expect(await p).toBe(false);
    expect(t.s.snapshot().phase).toBe('idle');
    expect(t.clicks).toHaveLength(0);
  });

  it('소리를 예약하지 못한 박은 계획한 시각으로 계산한다', async () => {
    const t = setup({ click: () => null });
    await t.s.start();
    const first = 1400;
    const targets = Array.from({ length: 12 }, (_, i) => first + (TIMING_CAL_LISTEN_BEATS + i) * BEAT + 20);
    let next = 0;
    t.advanceTo(first + 16 * BEAT + 400, (now) => {
      while (next < targets.length && targets[next] <= now) t.s.intercept(hit(targets[next++]));
    });
    expect(t.s.snapshot().result).toMatchObject({ status: 'ok', offsetMs: 20 });
  });
});
