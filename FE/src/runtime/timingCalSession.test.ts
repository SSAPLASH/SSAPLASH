// 박자 맞추기 진행 검증: 16박 예약, 단계 전환, 타격 가로채기(소리만), 결과 계산, 취소.
import { describe, expect, it } from 'vitest';
import { TimingCalSession, TIMING_CAL_TOTAL_BEATS, TIMING_CAL_TOTAL_BEATS_WITH_KICK, type TimingCalDeps } from './timingCalSession';
import { timingCalBeatMs, TIMING_CAL_LISTEN_BEATS } from '@/domain/kit/calibration/timingCalibration';
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
    kickConnected: () => false,
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
    expect(snap.outcome?.stick).toMatchObject({ status: 'ok', pairs: 12, offsetMs: -65, input: 'sensor' });
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
    expect(t.s.snapshot().outcome?.stick).toMatchObject({ status: 'few', pairs: 0, offsetMs: null });
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
    expect(t.s.snapshot().outcome?.stick).toMatchObject({ status: 'ok', offsetMs: 20 });
  });

  it('킥이 연결돼 있지 않으면 16박이고 킥 결과는 null', async () => {
    const t = setup();
    await t.s.start();
    expect(t.s.snapshot()).toMatchObject({ withKick: false, totalBeats: 16 });
    t.advanceTo(1400 + 16 * BEAT + 400);
    const snap = t.s.snapshot();
    expect(t.clicks).toHaveLength(16);
    expect(snap.phase).toBe('result');
    expect(snap.outcome?.kick).toBeNull();
  });

  describe('킥 연결', () => {
    const first = 1400;
    const stickAt = (i: number) => first + (TIMING_CAL_LISTEN_BEATS + i) * BEAT;
    const kickAt = (i: number) => first + (TIMING_CAL_LISTEN_BEATS + 12 + 4 + i) * BEAT;

    it('32박을 예약하고 listen, measure, switch, kick, result 순으로 넘어간다', async () => {
      const t = setup({ kickConnected: () => true });
      await t.s.start();
      expect(t.s.snapshot()).toMatchObject({ withKick: true, totalBeats: 32 });
      const phases: string[] = [];
      t.advanceTo(first + 32 * BEAT + 400, () => {
        const p = t.s.snapshot().phase;
        if (phases[phases.length - 1] !== p) phases.push(p);
      });
      expect(t.clicks).toHaveLength(TIMING_CAL_TOTAL_BEATS_WITH_KICK);
      expect(phases).toEqual(['listen', 'measure', 'switch', 'kick', 'result']);
      expect(t.s.snapshot().phase).toBe('result');
    });

    it('구간 경계에서 단계가 바뀌고 running은 result 전까지 true', async () => {
      const t = setup({ kickConnected: () => true });
      await t.s.start();
      t.advanceTo(first + 15 * BEAT + 10);
      expect(t.s.snapshot()).toMatchObject({ phase: 'measure', beat: 16 });
      t.advanceTo(first + 16 * BEAT + 10);
      expect(t.s.snapshot()).toMatchObject({ phase: 'switch', beat: 17 });
      expect(t.s.running).toBe(true);
      t.advanceTo(first + 20 * BEAT + 10);
      expect(t.s.snapshot()).toMatchObject({ phase: 'kick', beat: 21 });
      expect(t.s.running).toBe(true);
    });

    it('스틱 −65, 킥 −40: 구간별로 그 입력만 계산하고 하이햇 페달은 소리만 낸다', async () => {
      const t = setup({ kickConnected: () => true });
      await t.s.start();
      const events: { at: number; h: ResolvedHit }[] = [];
      for (let i = 0; i < 12; i++) events.push({ at: stickAt(i) - 65, h: hit(stickAt(i) - 65) });
      for (let i = 0; i < 12; i++) events.push({ at: kickAt(i) - 40, h: hit(kickAt(i) - 40, { pad: 'KICK', foot: 3 } as Partial<ResolvedHit>) });
      // 하이햇 페달: 킥 박 위에 밟아도 모으지 않는다
      events.push({ at: kickAt(0), h: hit(kickAt(0), { pad: 'HIHAT_PEDAL', foot: 2 } as Partial<ResolvedHit>) });
      events.sort((a, b) => a.at - b.at);
      let next = 0;
      t.advanceTo(first + 32 * BEAT + 400, (now) => {
        while (next < events.length && events[next].at <= now) t.s.intercept(events[next++].h);
      });
      const o = t.s.snapshot().outcome;
      expect(o?.stick).toMatchObject({ status: 'ok', pairs: 12, offsetMs: -65 });
      expect(o?.kick).toMatchObject({ status: 'ok', pairs: 12, offsetMs: -40 });
      expect(o?.recheck).toBe(false);
      expect(t.played).toHaveLength(25);
    });

    it('화면용 타격 수는 지금 구간 입력만 센다', async () => {
      const t = setup({ kickConnected: () => true });
      await t.s.start();
      t.advanceTo(stickAt(3) + 10);
      t.s.intercept(hit(stickAt(2)));
      t.s.intercept(hit(stickAt(3), { pad: 'KICK', foot: 3 } as Partial<ResolvedHit>));
      expect(t.s.snapshot()).toMatchObject({ phase: 'measure', taps: 1 });
      t.advanceTo(kickAt(2) + 10);
      expect(t.s.snapshot()).toMatchObject({ phase: 'kick', taps: 0 });
      t.s.intercept(hit(kickAt(2), { pad: 'KICK', foot: 3 } as Partial<ResolvedHit>));
      expect(t.s.snapshot().taps).toBe(1);
    });
  });
});
