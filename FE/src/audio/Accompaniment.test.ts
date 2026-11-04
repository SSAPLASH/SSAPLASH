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
