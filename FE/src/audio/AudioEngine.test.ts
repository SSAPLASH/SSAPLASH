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

  it('짝이 현재 시각과 1초 넘게 어긋나면(오래된 값) 대체 짝을 쓴다', async () => {
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
    expect(e.click(undefined, true)).toBeNull();
  });

  it('suspended이면 소리를 예약하지 않고 null', async () => {
    const e = await engineWith({ state: 'suspended', currentTime: 0, ts: { contextTime: 0, performanceTime: 0 } });
    expect(e.trigger('KICK', 100)).toBeNull();
    expect(e.click(5100, false)).toBeNull();
  });

  it('running이면 performance.now 기준 숫자를 돌려준다', async () => {
    const e = await engineWith({ state: 'running', currentTime: 10, ts });
    const t = e.trigger('KICK', 100);
    expect(t).not.toBeNull();
    expect(Math.abs((t as number) - 5000)).toBeLessThan(100);
    const c = e.click(undefined, true);
    expect(c).not.toBeNull();
    expect(Math.abs((c as number) - 5000)).toBeLessThan(100);
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
