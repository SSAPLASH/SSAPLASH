import { describe, expect, it, vi } from 'vitest';
import { Accompaniment } from './Accompaniment';
import type { AudioEngine } from './AudioEngine';

function setup() {
  const sources: { playbackRate: { value: number }; start: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    currentTime: 0,
    createBufferSource: () => {
      const s = {
        buffer: null as unknown,
        playbackRate: { value: 1 },
        onended: null as unknown,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(s);
      return s;
    },
    decodeAudioData: vi.fn(async () => ({ duration: 60 })),
  };
  const engine = {
    context: ctx,
    accompanimentBus: {},
    perfToContextTime: () => 1,
    contextToPerfTime: () => 1000,
    ensure: async () => ctx,
  } as unknown as AudioEngine;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
  return { acc: new Accompaniment(engine), sources };
}

describe('Accompaniment setRate', () => {
  it('다음 start의 소스에 배속을 적용한다', async () => {
    const { acc, sources } = setup();
    await acc.load('https://x/a.mp3');
    acc.setRate(0.75);
    acc.start(1000, 0);
    expect(sources[0].playbackRate.value).toBe(0.75);
    vi.unstubAllGlobals();
  });

  it('재생 중 호출하면 현재 소스에도 적용하고, 잘못된 값은 1로 본다', async () => {
    const { acc, sources } = setup();
    await acc.load('https://x/a.mp3');
    acc.start(1000, 0);
    acc.setRate(0.75);
    expect(sources[0].playbackRate.value).toBe(0.75);
    acc.setRate(0);
    expect(sources[0].playbackRate.value).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('Accompaniment audioPositionAt', () => {
  /** 오디오 시계가 performance.now보다 factor배 빠르게 흐르는 엔진(getOutputTimestamp를 매번 다시 읽는 변환과 같은 모양) */
  function drifting(factor: number) {
    const ctx = {
      currentTime: 0,
      createBufferSource: () => ({
        buffer: null as unknown,
        playbackRate: { value: 1 },
        onended: null as unknown,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      decodeAudioData: vi.fn(async () => ({ duration: 600 })),
    };
    const engine = {
      context: ctx,
      accompanimentBus: {},
      perfToContextTime: (p: number) => 1 + ((p - 1000) / 1000) * factor,
      contextToPerfTime: (c: number) => 1000 + ((c - 1) * 1000) / factor,
      ensure: async () => ctx,
    } as unknown as AudioEngine;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
    return new Accompaniment(engine);
  }

  it('오디오 시계 드리프트를 드러낸다: audioPositionAt은 분당 6ms씩 앞선다', async () => {
    const acc = drifting(1.0001);
    await acc.load('https://x/a.mp3');
    acc.start(1000, 0);
    expect(acc.audioPositionAt(500)).toBeNull();
    expect(acc.audioPositionAt(61_000)).toBeCloseTo(60_006, 3);
    vi.unstubAllGlobals();
  });

  it('배속 0.75를 곡 시각 축으로 환산하고, 재생 중 배속을 바꿔도 위치가 이어진다', async () => {
    const acc = drifting(1);
    await acc.load('https://x/a.mp3');
    acc.setRate(0.75);
    acc.start(1000, 2000);
    expect(acc.audioPositionAt(5000)).toBeCloseTo(2000 + 4000 * 0.75, 6);
    const spy = vi.spyOn(performance, 'now').mockReturnValue(5000);
    acc.setRate(1);
    spy.mockRestore();
    expect(acc.audioPositionAt(6000)).toBeCloseTo(2000 + 3000 + 1000, 6);
    vi.unstubAllGlobals();
  });

  it('재생 중이 아니면 null', async () => {
    const acc = drifting(1);
    await acc.load('https://x/a.mp3');
    expect(acc.audioPositionAt(2000)).toBeNull();
    vi.unstubAllGlobals();
  });
});
