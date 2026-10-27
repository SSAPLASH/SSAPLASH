import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';

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
