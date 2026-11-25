import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipError, createOneShotAudio, type OneShotEngine } from './oneShotAudio';

// 실제 오디오 없이 손으로 만든 가짜 컨텍스트. 만들어진 소스·게인을 배열에 모아 둔다.
interface FakeSource {
  buffer: unknown;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}
interface FakeGain {
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const fakeBuffer = { duration: 20.5 };

let sources: FakeSource[];
let gains: FakeGain[];
let context: { currentTime: number; state: string; createBufferSource: () => FakeSource; createGain: () => FakeGain; decodeAudioData: ReturnType<typeof vi.fn> };
let bus: object;

function makeContext() {
  return {
    currentTime: 0,
    state: 'running',
    createBufferSource: () => {
      const source: FakeSource = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
      sources.push(source);
      return source;
    },
    createGain: () => {
      const gain: FakeGain = {
        gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    },
    decodeAudioData: vi.fn(async () => fakeBuffer),
  };
}

interface MutableEngine {
  context: typeof context | null;
  accompanimentBus: object | null;
}

let engine: MutableEngine;

function okResponse() {
  return { ok: true, status: 200, arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) };
}

function setup(fetchImpl?: ReturnType<typeof vi.fn>) {
  const fetchMock = fetchImpl ?? vi.fn(async () => okResponse());
  const player = createOneShotAudio({ engine: engine as unknown as OneShotEngine, fetch: fetchMock as unknown as typeof fetch });
  return { player, fetchMock };
}

const buffer = fakeBuffer as unknown as AudioBuffer;

beforeEach(() => {
  sources = [];
  gains = [];
  context = makeContext();
  bus = {};
  engine = { context, accompanimentBus: bus };
});

describe('loadClip', () => {
  it('주소를 받아 풀어 버퍼를 돌려준다', async () => {
    const { player, fetchMock } = setup();
    await expect(player.loadClip('/a/iwaly.wav')).resolves.toBe(fakeBuffer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/a/iwaly.wav', expect.objectContaining({ credentials: 'omit' }));
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it('같은 주소는 다시 받지 않고 같은 버퍼를 돌려준다', async () => {
    const { player, fetchMock } = setup();
    const first = await player.loadClip('/a/iwaly.wav');
    const second = await player.loadClip('/a/iwaly.wav');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('다른 주소는 각각 받는다', async () => {
    const { player, fetchMock } = setup();
    await player.loadClip('/a/one.wav');
    await player.loadClip('/a/two.wav');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 안내 단계에서는 사용자가 아직 아무것도 누르지 않아 오디오 컨텍스트가 없을 수 있다. 그때는 풀기만 하는 컨텍스트로 푼다
  it('컨텍스트가 아직 없으면 풀기용 컨텍스트로 푼다', async () => {
    engine.context = null;
    const decodeAudioData = vi.fn(async () => fakeBuffer);
    const decoder = vi.fn(() => ({ decodeAudioData }) as unknown as Pick<BaseAudioContext, 'decodeAudioData'>);
    const fetchMock = vi.fn(async () => okResponse());
    const player = createOneShotAudio({ engine: engine as never, fetch: fetchMock as never, decoder });
    await expect(player.loadClip('/a/iwaly.wav')).resolves.toBe(fakeBuffer);
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it('컨텍스트가 있으면 그 컨텍스트로 풀고 풀기용 컨텍스트를 만들지 않는다', async () => {
    const decoder = vi.fn();
    const fetchMock = vi.fn(async () => okResponse());
    const player = createOneShotAudio({ engine: engine as never, fetch: fetchMock as never, decoder: decoder as never });
    await player.loadClip('/a/iwaly.wav');
    expect(decoder).not.toHaveBeenCalled();
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
  });
});

describe('loadClip 실패', () => {
  it('응답이 ok가 아니면 kind가 fetch인 ClipError', async () => {
    const { player } = setup(vi.fn(async () => ({ ok: false, status: 404 })));
    const error = await player.loadClip('/a/x.wav').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClipError);
    expect((error as ClipError).kind).toBe('fetch');
  });

  it('fetch가 거부되면 kind가 fetch인 ClipError', async () => {
    const { player } = setup(vi.fn(async () => Promise.reject(new Error('network'))));
    const error = await player.loadClip('/a/x.wav').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClipError);
    expect((error as ClipError).kind).toBe('fetch');
  });

  it('decodeAudioData가 거부되면 kind가 decode인 ClipError', async () => {
    context.decodeAudioData = vi.fn(async () => Promise.reject(new Error('bad data')));
    const { player } = setup();
    const error = await player.loadClip('/a/x.wav').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClipError);
    expect((error as ClipError).kind).toBe('decode');
  });

  it('실패한 주소는 기억하지 않아 다음 호출에서 다시 받는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(okResponse());
    const { player } = setup(fetchMock);
    await expect(player.loadClip('/a/x.wav')).rejects.toBeInstanceOf(ClipError);
    await expect(player.loadClip('/a/x.wav')).resolves.toBe(fakeBuffer);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('이미 중단된 신호로 fetch가 거부되면 ClipError로 바꾸지 않고 원래 오류를 던진다', async () => {
    const abortError = new Error('aborted');
    const controller = new AbortController();
    controller.abort();
    const { player } = setup(vi.fn(async () => Promise.reject(abortError)));
    const error = await player.loadClip('/a/x.wav', controller.signal).catch((e: unknown) => e);
    expect(error).toBe(abortError);
    expect(error).not.toBeInstanceOf(ClipError);
  });
});

describe('playHead', () => {
  it('앞부분을 예약하고 시작 오디오 시각을 돌려준다', () => {
    context.currentTime = 10;
    const { player } = setup();
    expect(player.playHead(buffer, 10.4, 12500)).toBe(10.4);
    expect(sources).toHaveLength(1);
    expect(gains).toHaveLength(1);
    expect(sources[0].buffer).toBe(fakeBuffer);
    expect(sources[0].connect).toHaveBeenCalledWith(gains[0]);
    expect(gains[0].connect).toHaveBeenCalledWith(bus);
    expect(sources[0].start).toHaveBeenCalledWith(10.4, 0, 12.5);
    const ramps = gains[0].gain.linearRampToValueAtTime.mock.calls;
    const [value, endAt] = ramps[ramps.length - 1] as [number, number];
    expect(value).toBe(0);
    expect(endAt).toBeCloseTo(10.4 + 12.5, 6);
  });

  it('이미 지난 시각이면 지금부터 시작한다', () => {
    context.currentTime = 10;
    const { player } = setup();
    expect(player.playHead(buffer, 9, 12500)).toBe(10);
    expect(sources[0].start).toHaveBeenCalledWith(10, 0, 12.5);
  });

  it('컨텍스트가 없으면 null이고 아무것도 만들지 않는다', () => {
    engine.context = null;
    const { player } = setup();
    expect(player.playHead(buffer, 1, 12500)).toBeNull();
    expect(sources).toHaveLength(0);
    expect(gains).toHaveLength(0);
  });

  it('버스가 없으면 null이고 아무것도 만들지 않는다', () => {
    engine.accompanimentBus = null;
    const { player } = setup();
    expect(player.playHead(buffer, 1, 12500)).toBeNull();
    expect(sources).toHaveLength(0);
    expect(gains).toHaveLength(0);
  });

  it('컨텍스트가 멈춰(suspended) 있으면 null이고 아무것도 만들지 않는다', () => {
    context.state = 'suspended';
    const { player } = setup();
    expect(player.playHead(buffer, 1, 12500)).toBeNull();
    expect(sources).toHaveLength(0);
    expect(gains).toHaveLength(0);
  });
});

describe('playTail', () => {
  it('정답 위치부터 지금 바로, 남은 길이를 넘지 않게 튼다', () => {
    context.currentTime = 20;
    const { player } = setup();
    player.playTail(buffer, 12500, 8000);
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledTimes(1);
    const [when, offset, length] = sources[0].start.mock.calls[0] as [number, number, number];
    expect(when).toBe(20);
    expect(offset).toBeCloseTo(12.5, 6);
    expect(length).toBeCloseTo(8, 6);
  });

  it('더 길게 달라고 해도 남은 길이(8초)로 줄인다', () => {
    context.currentTime = 20;
    const { player } = setup();
    player.playTail(buffer, 12500, 10000);
    const [, , length] = sources[0].start.mock.calls[0] as [number, number, number];
    expect(length).toBeCloseTo(8, 6);
  });

  it('아직 울리는 앞부분은 줄여 끊고 나서 시작한다', () => {
    context.currentTime = 10;
    const { player } = setup();
    player.playHead(buffer, 10.4, 12500);
    context.currentTime = 12;
    player.playTail(buffer, 12500, 8000);
    expect(sources).toHaveLength(2);
    const [head, tail] = sources;
    expect(head.stop).toHaveBeenCalledTimes(1);
    const [stopAt] = head.stop.mock.calls[0] as [number];
    expect(stopAt).toBeGreaterThan(12);
    expect(stopAt).toBeLessThan(12.1);
    const headRamps = gains[0].gain.linearRampToValueAtTime.mock.calls;
    expect(headRamps[headRamps.length - 1][0]).toBe(0);
    expect(tail.start).toHaveBeenCalledTimes(1);
  });

  it('정답 위치가 버퍼 끝이거나 그 뒤면 소스를 시작하지 않는다', () => {
    const { player } = setup();
    player.playTail(buffer, 20500, 8000);
    player.playTail(buffer, 25000, 8000);
    expect(sources).toHaveLength(0);
  });

  it('컨텍스트가 돌고 있지 않으면 아무것도 하지 않는다', () => {
    context.state = 'suspended';
    const { player } = setup();
    player.playTail(buffer, 12500, 8000);
    expect(sources).toHaveLength(0);
  });
});

describe('stop', () => {
  it('울리는 소스마다 stop을 부르고 게인을 0으로 줄인다', () => {
    context.currentTime = 5;
    const { player } = setup();
    player.playHead(buffer, 5, 12500);
    player.stop();
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    const ramps = gains[0].gain.linearRampToValueAtTime.mock.calls;
    expect(ramps[ramps.length - 1][0]).toBe(0);
  });

  it('두 번 불러도 던지지 않고 같은 소스를 다시 멈추지 않는다', () => {
    const { player } = setup();
    player.playHead(buffer, 0, 12500);
    player.stop();
    expect(() => player.stop()).not.toThrow();
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
  });

  it('onended가 불린 소스는 잊어서 나중의 stop이 건드리지 않는다', () => {
    const { player } = setup();
    player.playHead(buffer, 0, 12500);
    sources[0].onended?.();
    expect(gains[0].disconnect).toHaveBeenCalled();
    player.stop();
    expect(sources[0].stop).not.toHaveBeenCalled();
  });

  it('컨텍스트가 없어도 던지지 않는다', () => {
    const { player } = setup();
    player.playHead(buffer, 0, 12500);
    engine.context = null;
    expect(() => player.stop()).not.toThrow();
  });
});
