import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, softLimitCurve } from './AudioEngine';

// getOutputTimestamp·state만 바꿔 가며 쓰는 최소 AudioContext 모의
interface MockOpts {
  state: string;
  currentTime: number;
  ts: { contextTime?: number; performanceTime?: number };
}

function makeParam() {
  return { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

function makeNode() {
  const node: Record<string, unknown> = {
    gain: makeParam(),
    frequency: makeParam(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  node.connect = vi.fn(() => node);
  return node;
}

function installMock(opts: MockOpts) {
  class MockAudioContext {
    state = opts.state;
    currentTime = opts.currentTime;
    sampleRate = 48000;
    destination = makeNode();
    addEventListener = vi.fn();
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    getOutputTimestamp = () => opts.ts;
    createGain = () => makeNode();
    createOscillator = () => makeNode();
    createWaveShaper = () => makeNode();
    createBuffer = (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  }
  vi.stubGlobal('AudioContext', MockAudioContext);
}

async function engineWith(opts: MockOpts): Promise<AudioEngine> {
  installMock(opts);
  const e = new AudioEngine();
  await e.ensure();
  // ensure()가 resume으로 running이 되므로 시험하려는 상태로 되돌린다
  (e.context as unknown as { state: string }).state = opts.state;
  return e;
}

describe('AudioEngine 시각 변환', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(5000);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getOutputTimestamp가 {0,0}이면 currentTime↔performance.now 짝으로 변환한다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 0, performanceTime: 0 } });
    expect(e.contextToPerfTime(11)).toBeCloseTo(6000);
    expect(e.perfToContextTime(6000)).toBeCloseTo(11);
  });

  it('performanceTime이 undefined이면 대체 짝을 쓴다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 3 } });
    expect(e.contextToPerfTime(11)).toBeCloseTo(6000);
    expect(e.perfToContextTime(6000)).toBeCloseTo(11);
  });

  it('출력 지연이 1.2초여도 정상 짝이면 그 짝을 쓴다(지연 보정 유지)', async () => {
    // 들리는 시각 = 8.8 + 0.05 = 8.85 → currentTime 10보다 1.15초 뒤
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 8.8, performanceTime: 4950 } });
    expect(e.perfToContextTime(5000)).toBeCloseTo(8.85, 9);
    expect(e.renderAheadMs()).toBeCloseTo(1150, 6);
  });

  it('짝이 현재 시각과 3초 넘게 어긋나면(오래된 값) 대체 짝을 쓴다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 1, performanceTime: 100 } });
    expect(e.contextToPerfTime(11)).toBeCloseTo(6000);
    expect(e.perfToContextTime(6000)).toBeCloseTo(11);
  });

  it('정상 짝이면 getOutputTimestamp 기준 그대로 변환한다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 9.9, performanceTime: 4950 } });
    expect(e.contextToPerfTime(11)).toBeCloseTo(6050);
    expect(e.perfToContextTime(6050)).toBeCloseTo(11);
  });
});

describe('AudioEngine trigger·click 반환', () => {
  const ts = { contextTime: 9.9, performanceTime: 4950 };
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(5000);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('컨텍스트가 없으면 null', () => {
    const e = new AudioEngine();
    expect(e.trigger('KICK', 100)).toBeNull();
    expect(e.click(undefined, 'accent')).toBeNull();
  });

  it('suspended이면 소리를 예약하지 않고 null', async () => {
    const e = await engineWith({ state: 'suspended', currentTime: 0, ts: { contextTime: 0, performanceTime: 0 } });
    expect(e.trigger('KICK', 100)).toBeNull();
    expect(e.click(5100, 'beat')).toBeNull();
  });

  it('클릭 3단계(첫 박·정박·사이 박)는 주파수와 음량이 서로 다르고 사이 박이 가장 낮고 작다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts });
    const ctx = e.context as unknown as { createOscillator: () => unknown; createGain: () => unknown };
    const oscs: { frequency: { value: number } }[] = [];
    const gains: { gain: { setValueAtTime: ReturnType<typeof vi.fn> } }[] = [];
    const osc = ctx.createOscillator;
    const gain = ctx.createGain;
    ctx.createOscillator = () => {
      const n = osc() as (typeof oscs)[number];
      oscs.push(n);
      return n;
    };
    ctx.createGain = () => {
      const n = gain() as (typeof gains)[number];
      gains.push(n);
      return n;
    };
    e.click(undefined, 'accent');
    e.click(undefined, 'beat');
    e.clickAtContext(10.2, 'sub');
    expect(oscs.map((o) => o.frequency.value)).toEqual([1600, 1100, 800]);
    const vol = gains.map((g) => g.gain.setValueAtTime.mock.calls[0][0] as number);
    expect(vol[0]).toBeGreaterThan(vol[1]);
    expect(vol[1]).toBeGreaterThan(vol[2]);
    expect(vol[2]).toBeGreaterThan(0);
  });

  it('running이면 performance.now 기준 숫자를 돌려준다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts });
    const t = e.trigger('KICK', 100);
    expect(t).not.toBeNull();
    expect(Math.abs((t as number) - 5000)).toBeLessThan(100);
    const c = e.click(undefined, 'accent');
    expect(c).not.toBeNull();
    expect(Math.abs((c as number) - 5000)).toBeLessThan(100);
  });
});

describe('AudioEngine 앞선 정도·오디오 시계 읽기·오디오 시각 클릭 (설계 MODE-001 연주 시계를 오디오 시계 하나로)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(5000);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('앞선 정도 = currentTime − 지금 들리는 오디오 시각', async () => {
    // 지금 들리는 시각 = 9.9 + (5000 − 4950)/1000 = 9.95 → 50ms 앞섬
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 9.9, performanceTime: 4950 } });
    expect(e.renderAheadMs()).toBeCloseTo(50, 6);
    const r = e.audioReading();
    expect(r?.ctxSec).toBe(10);
    expect(r?.heardCtxSec).toBeCloseTo(9.95, 9);
  });

  it('출력 지연이 0.45초면 100ms 앞 예약은 당겨지고, 앞선 정도를 더한 예약은 그대로다', async () => {
    // 들리는 시각 = 9.5 + 0.05 = 9.55 → 450ms 앞섬
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 9.5, performanceTime: 4950 } });
    const ahead = e.renderAheadMs();
    expect(ahead).toBeCloseTo(450, 6);
    // 100ms 뒤에 들리게 하려는 클릭: 바꾼 오디오 시각 9.65 < currentTime 10 → 지금(10)으로 당겨져 450ms에 들림
    const late = e.click(5100, 'beat') as number;
    expect(late - 5100).toBeCloseTo(350, 6);
    // 여유에 앞선 정도를 더하면 당겨지지 않음
    const want = 5000 + 100 + ahead;
    expect(e.click(want, 'beat') as number).toBeCloseTo(want, 6);
  });

  it('오디오 시각 클릭은 currentTime보다 뒤면 그 시각, 앞이면 currentTime', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 9.5, performanceTime: 4950 } });
    expect(e.clickAtContext(10.2, 'accent')).toBeCloseTo(10.2, 9);
    expect(e.clickAtContext(9.8, 'accent')).toBe(10);
  });

  it('오디오 시각 타격음 예약은 그 시각에 놓이고 취소 핸들을 준다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts: { contextTime: 9.5, performanceTime: 4950 } });
    const h = e.triggerAtContext('KICK', 100, 10.3);
    expect(h).not.toBeNull();
    // 들리는 화면 시계 시각 = 4950 + (10.3 − 9.5) × 1000
    expect(h?.at).toBeCloseTo(5750, 6);
    expect(() => h?.cancel()).not.toThrow();
    const past = e.triggerAtContext('KICK', 100, 9.9);
    expect(past?.at).toBeCloseTo(4950 + (10 - 9.5) * 1000, 6);
  });

  it('running이 아니면 앞선 정도 0, 읽기 값 null', async () => {
    const e = await engineWith({ state: 'suspended', currentTime: 10, ts: { contextTime: 9.5, performanceTime: 4950 } });
    expect(e.renderAheadMs()).toBe(0);
    expect(e.audioReading()).toBeNull();
    expect(e.clickAtContext(10.2, 'accent')).toBeNull();
  });
});

describe('AudioEngine 드럼·노래 음량', () => {
  const ts = { contextTime: 9.9, performanceTime: 4950 };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  // 패드 버스는 비공개라 테스트에서만 꺼내 본다
  const padGain = (e: AudioEngine) => (e as unknown as { padBus: { gain: { value: number } } }).padBus.gain.value;
  const accGain = (e: AudioEngine) => e.accompanimentBus?.gain.value;

  it('ensure 전에 setDrumVolume하면 ensure 뒤 패드 버스에 반영된다', async () => {
    installMock({ state: 'running', currentTime: 10, ts });
    const e = new AudioEngine();
    e.setDrumVolume(1.5);
    await e.ensure();
    expect(padGain(e)).toBe(1.5);
  });

  it('음소거는 0, 풀면 1이 아니라 드럼 음량으로 돌아온다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts });
    e.setDrumVolume(1.5);
    e.setPadMuted(true);
    expect(padGain(e)).toBe(0);
    e.setDrumVolume(0.7);
    expect(padGain(e)).toBe(0);
    e.setPadMuted(false);
    expect(padGain(e)).toBe(0.7);
  });

  it('setSongVolume은 반주 버스 게인에 반영된다(ensure 전 호출 포함)', async () => {
    installMock({ state: 'running', currentTime: 10, ts });
    const e = new AudioEngine();
    e.setSongVolume(0.4);
    await e.ensure();
    expect(accGain(e)).toBe(0.4);
    e.setSongVolume(0.9);
    expect(accGain(e)).toBe(0.9);
  });

  it('유한수가 아닌 값은 무시한다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts });
    e.setDrumVolume(1.2);
    e.setDrumVolume(Number.NaN);
    expect(padGain(e)).toBe(1.2);
    e.setSongVolume(0.5);
    e.setSongVolume(Number.POSITIVE_INFINITY);
    expect(accGain(e)).toBe(0.5);
  });
});

describe('softLimitCurve', () => {
  const at = (c: Float32Array, x: number) => c[Math.round(((x / 4 + 1) / 2) * (c.length - 1))];
  it('문턱(0.8) 아래는 그대로 통과한다', () => {
    const c = softLimitCurve();
    for (const x of [0, 0.1, 0.5, 0.79, -0.5]) expect(at(c, x)).toBeCloseTo(x, 2);
  });
  it('문턱 위는 1을 넘지 않고 단조 증가한다', () => {
    const c = softLimitCurve();
    expect(at(c, 4)).toBeLessThanOrEqual(1);
    expect(at(c, 1.5)).toBeGreaterThan(at(c, 1));
    expect(at(c, -4)).toBeGreaterThanOrEqual(-1);
  });
});

describe('AudioEngine triggerScheduled', () => {
  const ts = { contextTime: 9.9, performanceTime: 4950 };
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(5000);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Gate = { disconnect: ReturnType<typeof vi.fn> };
  async function engineWithGates() {
    const e = await engineWith({ state: 'running', currentTime: 10, ts });
    const ctx = e.context as unknown as { createGain: () => unknown; currentTime: number };
    const gates: Gate[] = [];
    const orig = ctx.createGain;
    ctx.createGain = () => {
      const n = orig() as Gate;
      gates.push(n);
      return n;
    };
    return { e, ctx, gates };
  }

  it('running이 아니면 null', async () => {
    const e = await engineWith({ state: 'suspended', currentTime: 0, ts: { contextTime: 0, performanceTime: 0 } });
    expect(e.triggerScheduled('KICK', 90, 5100)).toBeNull();
  });

  it('아직 울리기 전에 cancel하면 출력 경로를 끊는다', async () => {
    const { e, gates } = await engineWithGates();
    const h = e.triggerScheduled('KICK', 90, 6000);
    expect(h).not.toBeNull();
    h!.cancel();
    expect(gates[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('이미 울린 뒤 cancel은 아무것도 하지 않고 던지지 않는다', async () => {
    const { e, ctx, gates } = await engineWithGates();
    const h = e.triggerScheduled('KICK', 90, 5100);
    ctx.currentTime = 20;
    expect(() => h!.cancel()).not.toThrow();
    expect(gates[0].disconnect).not.toHaveBeenCalled();
  });
});

describe('softLimitCurve', () => {
  const at = (c: Float32Array, x: number) => c[Math.round(((x / 4 + 1) / 2) * (c.length - 1))];
  it('문턱(0.8) 아래는 그대로 통과한다', () => {
    const c = softLimitCurve();
    for (const x of [0, 0.1, 0.5, 0.79, -0.5]) expect(at(c, x)).toBeCloseTo(x, 2);
  });
  it('문턱 위는 1을 넘지 않고 단조 증가한다', () => {
    const c = softLimitCurve();
    expect(at(c, 4)).toBeLessThanOrEqual(1);
    expect(at(c, 1.5)).toBeGreaterThan(at(c, 1));
    expect(at(c, -4)).toBeGreaterThanOrEqual(-1);
  });
});

describe('AudioEngine 하이햇 열림/닫힘 선택 (PLAY-002)', () => {
  /** createBufferSource로 만든 소스에 실린 buffer를 모으는 컨텍스트 모의 */
  const started: unknown[] = [];
  function installRecording() {
    class RecCtx {
      state = 'running';
      currentTime = 10;
      sampleRate = 48000;
      destination = makeNode();
      addEventListener = vi.fn();
      resume = vi.fn(async () => {});
      getOutputTimestamp = () => ({ contextTime: 9.9, performanceTime: 4950 });
      createGain = () => makeNode();
      createOscillator = () => makeNode();
      createWaveShaper = () => makeNode();
      createBiquadFilter = () => ({ ...makeNode(), Q: makeParam() });
      createBuffer = (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
      createBufferSource = () => {
        const n = makeNode();
        n.playbackRate = { value: 1 };
        (n.start as ReturnType<typeof vi.fn>).mockImplementation(() => started.push(n.buffer));
        return n;
      };
    }
    vi.stubGlobal('AudioContext', RecCtx);
  }
  const buf = (tag: string) => ({ tag }) as unknown as AudioBuffer;
  const sample = (tag: string) => ({ buffer: buf(tag), gain: 1, playbackRate: 1 });
  const soundSet = (withOpen: boolean) => ({
    id: 'ssaplash' as const,
    label: 't',
    kind: 'sample' as const,
    masterTrim: 1,
    pads: { HIHAT: sample('closed') },
    variants: withOpen ? { HIHAT_OPEN: sample('open') } : {},
    missing: [],
  });
  const tagsOf = () => started.map((b) => (b as { tag?: string } | undefined)?.tag);

  beforeEach(() => {
    started.length = 0;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    installRecording();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // 인수 조건: state 0이면 열림 샘플, state 1·미연결이면 닫힘 소리
  it('기본은 닫힘(closed 샘플), setHihatOpen(true) 뒤 HIHAT은 HIHAT_OPEN 샘플', async () => {
    const e = new AudioEngine();
    await e.ensure();
    e.setSoundSet(soundSet(true));
    e.trigger('HIHAT', 100);
    e.setHihatOpen(true);
    e.trigger('HIHAT', 100);
    e.setHihatOpen(false);
    e.trigger('HIHAT', 100);
    expect(tagsOf()).toEqual(['closed', 'open', 'closed']);
  });

  it('열림이어도 HIHAT 외 패드·HIHAT_PEDAL은 영향이 없다', async () => {
    const e = new AudioEngine();
    await e.ensure();
    e.setSoundSet({ ...soundSet(true), pads: { HIHAT: sample('closed'), KICK: sample('kick') } });
    e.setHihatOpen(true);
    e.trigger('KICK', 100);
    expect(tagsOf()).toEqual(['kick']);
  });

  it('HIHAT_PEDAL은 키트 페달 샘플을 쓰고, 없으면 하이햇 닫힘 샘플로 대신한다', async () => {
    const e = new AudioEngine();
    await e.ensure();
    e.setSoundSet({ ...soundSet(true), pads: { HIHAT: sample('closed'), HIHAT_PEDAL: sample('pedal') } });
    e.trigger('HIHAT_PEDAL', 100);
    e.setSoundSet(soundSet(true));
    e.trigger('HIHAT_PEDAL', 100);
    expect(tagsOf()).toEqual(['pedal', 'closed']);
  });

  it('열림인데 변형 샘플이 없으면 닫힘 샘플로 대신하지 않고 합성 열림 보이스를 낸다', async () => {
    const e = new AudioEngine();
    await e.ensure();
    e.setSoundSet(soundSet(false));
    e.setHihatOpen(true);
    const t = e.trigger('HIHAT', 100);
    expect(t).not.toBeNull();
    expect(tagsOf()).not.toContain('closed');
    expect(started).toHaveLength(1); // 합성 노이즈 보이스 하나
  });
});

// 시작·재개 전 오디오 시계 대기 (설계 MODE-001 오디오 시계 시작 대기 3장)
describe('AudioEngine.whenClockFlowing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * 가짜 시계(performance.now도 같은 값을 준다). sleep이 불릴 때마다 시간이 가고, 오디오 시계는 stalls 구간(대기 시작 기준 ms)에서만 멈춘다.
   * stallMs는 처음부터 그만큼 멈춰 있는 경우의 줄임이다.
   */
  async function setup(opts: { stallMs?: number; stalls?: [number, number][]; state?: string; outFresh?: boolean }) {
    const stalls: [number, number][] = opts.stalls ?? (opts.stallMs ? [[0, opts.stallMs]] : []);
    const ts: { contextTime?: number; performanceTime?: number } = { contextTime: 0, performanceTime: 0 };
    let t = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const e = await engineWith({ state: opts.state ?? 'running', currentTime: 0, ts });
    const ctx = e.context as unknown as { currentTime: number; state: string; resume: ReturnType<typeof vi.fn>; createOscillator: () => unknown };
    ctx.resume.mockClear();
    const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
    const makeOsc = ctx.createOscillator;
    ctx.createOscillator = () => {
      const o = makeOsc() as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
      oscillators.push(o);
      return o;
    };
    let start = t;
    const apply = () => {
      const elapsed = t - start;
      const stalled = stalls.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(elapsed, to) - from), 0);
      const flowed = elapsed - stalled;
      ctx.currentTime = flowed / 1000;
      if (opts.outFresh !== false && flowed > 0) {
        ts.contextTime = ctx.currentTime;
        ts.performanceTime = t;
      }
    };
    const sleeps: number[] = [];
    const deps = {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
        apply();
      },
    };
    return {
      e,
      ctx,
      deps,
      sleeps,
      oscillators,
      /** 대기를 시작하기 전에 시간을 보낸다(오디오 시계 기준은 대기 시작 시점으로 다시 잡는다) */
      idle(ms: number) {
        t += ms;
        start = t;
      },
      /** 방금 소리를 낸 상태로 만든다(출력 장치가 깨어 있음) */
      sound() {
        e.click(undefined, 'beat');
        oscillators.length = 0;
      },
    };
  }

  it('컨텍스트가 없으면 기다리지 않는다', async () => {
    installMock({ state: 'running', currentTime: 0, ts: {} });
    const e = new AudioEngine();
    const r = await e.whenClockFlowing();
    expect(r).toMatchObject({ timedOut: false, skipped: true, primed: false });
    // 실제 시계를 쓰므로 0에 가까운 값이다
    expect(r.waitedMs).toBeLessThan(5);
  });

  it('running이 아니면 기다리지 않고 깨우는 신호도 틀지 않는다', async () => {
    const s = await setup({ state: 'suspended' });
    expect(await s.e.whenClockFlowing(s.deps)).toEqual({ waitedMs: 0, timedOut: false, skipped: true, primed: false });
    expect(s.sleeps).toEqual([]);
    expect(s.oscillators).toHaveLength(0);
  });

  it('방금 소리를 냈고 시계가 흐르고 있으면 150ms 남짓 만에 끝난다(A4). 깨우는 신호는 틀지 않는다', async () => {
    const s = await setup({});
    s.sound();
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r).toMatchObject({ timedOut: false, skipped: false, primed: false });
    expect(r.waitedMs).toBeGreaterThanOrEqual(150);
    expect(r.waitedMs).toBeLessThanOrEqual(200);
    expect(new Set(s.sleeps)).toEqual(new Set([20]));
    expect(s.oscillators).toHaveLength(0);
  });

  it('소리를 낸 적이 없으면 들리지 않는 신호로 장치를 깨우고 350ms 이상 기다린 뒤 신호를 끈다', async () => {
    const s = await setup({});
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r).toMatchObject({ timedOut: false, skipped: false, primed: true });
    expect(r.waitedMs).toBeGreaterThanOrEqual(350);
    expect(r.waitedMs).toBeLessThanOrEqual(400);
    expect(s.oscillators).toHaveLength(1);
    expect(s.oscillators[0].start).toHaveBeenCalledTimes(1);
    expect(s.oscillators[0].stop).toHaveBeenCalledTimes(1);
  });

  it('소리를 낸 지 20초 안이면 깨우지 않고, 20초가 넘었으면 다시 깨운다', async () => {
    const recent = await setup({});
    recent.sound();
    recent.idle(19_000);
    expect((await recent.e.whenClockFlowing(recent.deps)).primed).toBe(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const old = await setup({});
    old.sound();
    old.idle(21_000);
    expect((await old.e.whenClockFlowing(old.deps)).primed).toBe(true);
  });

  it('깨운 직후에는 바로 다시 기다려도 깨우지 않는다(깨우는 신호도 소리다)', async () => {
    const s = await setup({});
    await s.e.whenClockFlowing(s.deps);
    s.idle(1000);
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r.primed).toBe(false);
    expect(s.oscillators).toHaveLength(1);
  });

  it('깨운 뒤 0.146초에 시계가 0.45초 멈추는 경우(측정): 멈춤이 끝나고 150ms 남짓 뒤에 끝난다', async () => {
    const s = await setup({ stalls: [[146, 596]] });
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r).toMatchObject({ timedOut: false, primed: true });
    expect(r.waitedMs).toBeGreaterThanOrEqual(596 + 140);
    expect(r.waitedMs).toBeLessThanOrEqual(596 + 200);
  });

  it('깨우지 않았다면 같은 경우에 멈춤 전에 통과해 버린다(깨우는 이유)', async () => {
    const s = await setup({ stalls: [[146, 596]] });
    s.sound();
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r.primed).toBe(false);
    expect(r.waitedMs).toBeLessThan(200);
  });

  it('700ms 멈췄다 흐르면(첫 접속), 흐른 지 150ms 남짓 뒤에 끝난다', async () => {
    const s = await setup({ stallMs: 700 });
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r.timedOut).toBe(false);
    expect(r.waitedMs).toBeGreaterThanOrEqual(850);
    expect(r.waitedMs).toBeLessThanOrEqual(900);
  });

  it('출력 시각이 갱신되지 않아도 시계가 500ms 계속 흐르면 끝난다', async () => {
    const s = await setup({ outFresh: false });
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r.timedOut).toBe(false);
    expect(r.waitedMs).toBeGreaterThanOrEqual(500);
    expect(r.waitedMs).toBeLessThanOrEqual(560);
  });

  it('끝내 흐르지 않으면 3초 뒤 timedOut으로 끝나고 신호를 끈다(A5)', async () => {
    const s = await setup({ stallMs: 60_000 });
    const r = await s.e.whenClockFlowing(s.deps);
    expect(r).toMatchObject({ timedOut: true, skipped: false });
    expect(r.waitedMs).toBeGreaterThanOrEqual(3000);
    expect(r.waitedMs).toBeLessThan(3050);
    expect(s.oscillators[0].stop).toHaveBeenCalledTimes(1);
  });

  it('최대 대기를 바꿀 수 있다', async () => {
    const s = await setup({ stallMs: 60_000 });
    const r = await s.e.whenClockFlowing({ ...s.deps, maxMs: 400 });
    expect(r.timedOut).toBe(true);
    expect(r.waitedMs).toBeGreaterThanOrEqual(400);
    expect(r.waitedMs).toBeLessThan(450);
  });

  it('기다리는 동안 resume()을 다시 부르지 않는다', async () => {
    const s = await setup({ stallMs: 700 });
    await s.e.whenClockFlowing(s.deps);
    expect(s.ctx.resume).not.toHaveBeenCalled();
  });

  it('기다리는 도중 컨텍스트가 멈추면(suspended) 바로 끝내고 신호를 끈다', async () => {
    const s = await setup({ stallMs: 60_000 });
    let n = 0;
    const r = await s.e.whenClockFlowing({
      now: s.deps.now,
      sleep: async (ms) => {
        await s.deps.sleep(ms);
        if (++n === 3) s.ctx.state = 'suspended';
      },
    });
    expect(r).toMatchObject({ timedOut: false, skipped: true });
    expect(r.waitedMs).toBe(60);
    expect(s.oscillators[0].stop).toHaveBeenCalledTimes(1);
  });

  it('패드 소리가 음소거면 소리를 낸 것으로 치지 않는다(무음은 장치를 깨우지 못한다)', async () => {
    // 이 모의 컨텍스트는 합성음 노드를 만들지 못해 trigger가 던진다. 소리를 낸 시각은 그 전에 기록된다
    const hit = (e: AudioEngine) => {
      try {
        e.trigger('SNARE', 100);
      } catch {
        // 모의 한계
      }
    };
    const muted = await setup({});
    muted.e.setPadMuted(true);
    hit(muted.e);
    expect((await muted.e.whenClockFlowing(muted.deps)).primed).toBe(true);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const audible = await setup({});
    hit(audible.e);
    expect((await audible.e.whenClockFlowing(audible.deps)).primed).toBe(false);
  });
});
