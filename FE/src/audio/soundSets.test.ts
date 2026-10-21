import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSampleSet, SYNTH_SET } from './soundSets';

const CONFIG = {
  name: 't',
  masterVolume: 0.21,
  adjustmentsBakedIntoWav: false,
  pads: {
    kick: { file: 'audio/kick.wav', gain: 1, playbackRate: 1 },
    snare: { file: 'audio/snare.wav', gain: 1.2, playbackRate: 1 },
    hihat: { file: 'audio/hihat.wav', gain: 0.8, playbackRate: 1 },
    mid: { file: 'audio/mid.wav', gain: 1, playbackRate: 1.19 },
  },
};

function mockFetch(failing: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('kit-config.json')) return { ok: true, status: 200, json: async () => CONFIG };
      if (failing.some((f) => url.endsWith(f))) return { ok: false, status: 404 };
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    }),
  );
}

function mockCtx(badDecode?: number) {
  let n = 0;
  return {
    decodeAudioData: vi.fn(async () => {
      if (n++ === badDecode) throw new Error('decode');
      return { duration: 1 } as unknown as AudioBuffer;
    }),
  } as unknown as AudioContext;
}

afterEach(() => vi.unstubAllGlobals());

describe('loadSampleSet', () => {
  it('synth는 빈 세트를 돌려준다', async () => {
    expect(await loadSampleSet(mockCtx(), 'synth')).toBe(SYNTH_SET);
  });

  it('전부 성공하면 missing이 비고 mid는 무시한다', async () => {
    mockFetch([]);
    const set = await loadSampleSet(mockCtx(), 'ssaplash');
    expect(Object.keys(set.pads).sort()).toEqual(['HIHAT', 'KICK', 'SNARE']);
    expect(set.missing).toEqual([]);
    expect(set.masterTrim).toBe(0.21);
    expect(set.pads.SNARE!.gain).toBe(1.2);
  });

  it('파일 하나가 404여도 그 패드만 missing', async () => {
    mockFetch(['snare.wav']);
    const set = await loadSampleSet(mockCtx(), 'ssaplash');
    expect(set.missing).toEqual(['SNARE']);
    expect(set.pads.KICK).toBeDefined();
    expect(set.pads.SNARE).toBeUndefined();
  });

  it('디코드 실패도 그 패드만 missing', async () => {
    mockFetch([]);
    const set = await loadSampleSet(mockCtx(0), 'ssaplash');
    expect(set.missing).toHaveLength(1);
    expect(Object.keys(set.pads)).toHaveLength(2);
  });

  it('kit-config.json을 못 읽으면 예외', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(loadSampleSet(mockCtx(), 'ssaplash')).rejects.toThrow();
  });
});
