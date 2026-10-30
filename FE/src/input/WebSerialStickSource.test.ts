import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSerialStickSource } from './WebSerialStickSource';
import { frame } from './serialFraming';

function fakePort(open: () => Promise<void>) {
  return {
    readable: { getReader: () => ({ read: () => new Promise(() => {}), releaseLock() {}, cancel: async () => {} }) },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
    open: vi.fn(open),
    close: vi.fn(async () => {}),
  };
}

function stubSerial(ports: unknown[]) {
  const serial = {
    getPorts: vi.fn(async () => ports),
    requestPort: vi.fn(async () => ports[0]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('navigator', { serial });
  // node 환경이라 window가 없다. 타이머만 빌려 쓴다
  vi.stubGlobal('window', { setInterval, clearInterval });
  return serial;
}

describe('WebSerialStickSource.autoConnect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('허락한 포트가 있으면 포트 선택 없이 연다', async () => {
    const port = fakePort(async () => {});
    const serial = stubSerial([port]);
    const src = new WebSerialStickSource();
    await src.autoConnect();
    expect(port.open).toHaveBeenCalledOnce();
    expect(serial.requestPort).not.toHaveBeenCalled();
    expect(src.state).toBe('connected');
    await src.disconnect();
  });

  it('허락한 포트가 없으면 조용히 끊김으로 둔다', async () => {
    const serial = stubSerial([]);
    const src = new WebSerialStickSource();
    await expect(src.autoConnect()).resolves.toBeUndefined();
    expect(src.state).toBe('disconnected');
    expect(serial.requestPort).not.toHaveBeenCalled();
  });

  it('열기에 실패해도 던지지 않고 끊김으로 둔다', async () => {
    stubSerial([fakePort(async () => Promise.reject(new Error('busy')))]);
    const src = new WebSerialStickSource();
    await expect(src.autoConnect()).resolves.toBeUndefined();
    expect(src.state).toBe('disconnected');
  });
});

/** 읽기 큐에 넣은 프레임을 내보내고 쓴 프레임의 payload를 모으는 포트 */
function livePort() {
  const queue: Uint8Array[] = [];
  let wake: (() => void) | null = null;
  const written: number[][] = [];
  const port = {
    readable: {
      getReader: () => ({
        read: async (): Promise<{ value?: Uint8Array; done: boolean }> => {
          while (queue.length === 0) await new Promise<void>((r) => (wake = r));
          return { value: queue.shift()!, done: false };
        },
        releaseLock() {},
        cancel: async () => {},
      }),
    },
    writable: {
      getWriter: () => ({
        // [SOF, LEN, payload…, CRC] → payload
        write: async (f: Uint8Array) => void written.push([...f.slice(2, 2 + f[1])]),
        releaseLock() {},
      }),
    },
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const feed = (payload: Uint8Array) => {
    queue.push(frame(payload));
    wake?.();
  };
  return { port, feed, written };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function syncAckBytes(role: number, t0: number, t1Us: number): Uint8Array {
  const b = new Uint8Array(10);
  const v = new DataView(b.buffer);
  b[0] = 0x04;
  b[1] = role;
  v.setUint32(2, t0, true);
  v.setUint32(6, t1Us, true);
  return b;
}

function poseBytes(role: number, tsUs: number): Uint8Array {
  const b = new Uint8Array(12);
  b[0] = 0x02;
  b[1] = role;
  new DataView(b.buffer).setUint32(2, tsUs, true);
  return b;
}

describe('WebSerialStickSource 동글(두 스틱 한 포트)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function open() {
    const live = livePort();
    stubSerial([live.port]);
    const src = new WebSerialStickSource();
    await src.autoConnect();
    await tick();
    return { src, ...live };
  }

  it('같은 SYNC에 두 스틱이 답하면 손별 시계를 따로 맞춘다', async () => {
    const { src, feed, written } = await open();
    const sync = written.find((w) => w[0] === 0x10)!;
    const t0 = new DataView(new Uint8Array(sync).buffer).getUint32(1, true);
    // 왼손 시계 1s, 오른손 시계 900s — 켜진 시점이 달라 시계가 크게 다르다
    feed(syncAckBytes(0, t0, 1_000_000));
    feed(syncAckBytes(1, t0, 900_000_000));
    await tick();
    const left = src.clockOffsetOf(0);
    const right = src.clockOffsetOf(1);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left! - right!).toBeCloseTo(899_000, 0);

    const events: { stickId: number; timestamp: number }[] = [];
    src.subscribe((e) => {
      if (e.kind === 'pose') events.push(e);
    });
    feed(poseBytes(0, 1_000_000));
    feed(poseBytes(1, 900_000_000));
    await tick();
    // 같은 순간을 가리키는 두 손의 시각이 같은 브라우저 시각으로 바뀐다
    expect(events).toHaveLength(2);
    expect(events[0].timestamp).toBeCloseTo(events[1].timestamp, 0);
    await src.disconnect();
  });

  it('한 손 명령은 LINK를 받은 뒤부터 ROUTE로 감싼다', async () => {
    const { src, feed, written } = await open();
    src.sendCommand(new Uint8Array([0x16, 0xc8, 0x00]), 1);
    await tick();
    // 동글 확인 전(예전 동글·직결)에는 그대로 보낸다
    expect(written.at(-1)).toEqual([0x16, 0xc8, 0x00]);

    feed(new Uint8Array([0x07, 0, 0b11, 2, 0]));
    await tick();
    src.sendCommand(new Uint8Array([0x16, 0xc8, 0x00]), 1);
    src.haptic(0, 200, 30);
    src.sendCommand(new Uint8Array([0x13]));
    await tick();
    expect(written.slice(-3)).toEqual([
      [0x70, 0b10, 0x16, 0xc8, 0x00],
      [0x70, 0b01, 0x12, 200, 3],
      [0x13],
    ]);
    await src.disconnect();
  });

  it('발 역할 패킷은 이벤트로 내보내지 않는다', async () => {
    const { src, feed } = await open();
    const events: unknown[] = [];
    src.subscribe((e) => events.push(e));
    feed(poseBytes(2, 1000));
    feed(new Uint8Array([0x03, 3, 80, 0, 1, 2]));
    await tick();
    expect(events).toEqual([]);
    await src.disconnect();
  });
});
