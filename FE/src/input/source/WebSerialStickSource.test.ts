import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSerialStickSource } from './WebSerialStickSource';
import { frame } from '@/input/serialFraming';
import { buildHit, buildLink, buildPedal, buildStatus, buildSyncAck } from '@/features/monitor/core/mockStick';

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

  it('이미 열려 있으면 다시 열지 않는다(같은 포트 이중 open 방지)', async () => {
    const port = fakePort(async () => {});
    stubSerial([port]);
    const src = new WebSerialStickSource();
    await src.autoConnect();
    await src.autoConnect();
    expect(port.open).toHaveBeenCalledOnce();
    expect(src.state).toBe('connected');
    await src.disconnect();
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
    // 두 패킷을 받은 실제 시각이 달라 오차가 생긴다. 느린 러너에서도 시계가 ~899초 벌어졌는지만 본다
    expect(Math.abs(left! - right! - 899_000)).toBeLessThan(50);

    const events: { stickId: number; timestamp: number }[] = [];
    src.subscribe((e) => {
      if (e.kind === 'pose') events.push(e);
    });
    feed(poseBytes(0, 1_000_000));
    feed(poseBytes(1, 900_000_000));
    await tick();
    // 같은 순간을 가리키는 두 손의 시각이 같은 브라우저 시각으로 바뀐다
    expect(events).toHaveLength(2);
    expect(Math.abs(events[0].timestamp - events[1].timestamp)).toBeLessThan(50);
    await src.disconnect();
  });

  it('한 손 명령은 LINK를 받은 뒤부터 ROUTE로 감싼다', async () => {
    const { src, feed, written } = await open();
    // 연결 직후 50ms 간격 SYNC가 끼어들 수 있어 SYNC는 빼고 본다
    const commands = () => written.filter((w) => w[0] !== 0x10);
    src.sendCommand(new Uint8Array([0x16, 0xc8, 0x00]), 1);
    await tick();
    // 동글 확인 전(예전 동글·직결)에는 그대로 보낸다
    expect(commands().at(-1)).toEqual([0x16, 0xc8, 0x00]);

    feed(new Uint8Array([0x07, 0, 0b11, 2, 0]));
    await tick();
    src.sendCommand(new Uint8Array([0x16, 0xc8, 0x00]), 1);
    src.haptic(0, 200, 30);
    src.sendCommand(new Uint8Array([0x13]));
    await tick();
    expect(commands().slice(-3)).toEqual([
      [0x70, 0b10, 0x16, 0xc8, 0x00],
      [0x70, 0b01, 0x12, 200, 3],
      [0x13],
    ]);
    await src.disconnect();
  });

  it('발 역할 pose는 내보내지 않고, 동글 전 발 STATUS는 연결로 본다(손과 같은 규칙)', async () => {
    const { src, feed } = await open();
    const events: unknown[] = [];
    src.subscribe((e) => events.push(e));
    feed(poseBytes(2, 1000));
    feed(new Uint8Array([0x03, 3, 80, 0, 1, 2]));
    await tick();
    expect(events).toEqual([{ kind: 'pedalStatus', foot: 3, connected: true, batteryPct: 80 }]);
    await src.disconnect();
  });

  it('LINK bit2·3로 발 연결·끊김을 pedalStatus로 알리고, STATUS 배터리는 붙기 전 보류한다', async () => {
    const { src, feed } = await open();
    const events: { kind: string; foot?: number; connected?: boolean; batteryPct?: number }[] = [];
    src.subscribe((e) => {
      if (e.kind === 'pedalStatus') events.push(e);
    });
    feed(new Uint8Array([0x07, 0, 0b0000, 2, 0]));
    feed(new Uint8Array([0x03, 2, 70, 0, 1, 2]));
    await tick();
    expect(events.filter((e) => e.connected).length).toBe(0);
    feed(new Uint8Array([0x07, 0, 0b0100, 2, 0]));
    await tick();
    expect(events.at(-1)).toEqual({ kind: 'pedalStatus', foot: 2, connected: true, batteryPct: 70 });
    feed(new Uint8Array([0x03, 2, 65, 0, 1, 2]));
    await tick();
    expect(events.at(-1)).toEqual({ kind: 'pedalStatus', foot: 2, connected: true, batteryPct: 65 });
    feed(new Uint8Array([0x07, 0, 0b0000, 2, 0]));
    await tick();
    expect(events.at(-1)).toEqual({ kind: 'pedalStatus', foot: 2, connected: false });
    await src.disconnect();
  });
});

describe('WebSerialStickSource LINK 연결 판정', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function open() {
    const live = livePort();
    const serial = stubSerial([live.port]);
    const src = new WebSerialStickSource();
    const dongle: Array<string | null> = [];
    src.onDongle((d) => dongle.push(d));
    const status: Array<[number, boolean, number | undefined]> = [];
    src.subscribe((e) => {
      if (e.kind === 'status') status.push([e.stickId, e.connected, e.batteryPct]);
    });
    await src.autoConnect();
    await tick();
    return { src, serial, dongle, status, ...live };
  }
  const link = (mask: number) => new Uint8Array([0x07, 0, mask, 2, 0]);
  const statusBytes = (role: number, battery: number) => new Uint8Array([0x03, role, battery, 0, 1, 2]);

  it('포트가 열리면 waiting, LINK를 받으면 ok, 닫히면 null', async () => {
    const { src, feed, dongle } = await open();
    expect(dongle).toEqual(['waiting']);
    feed(link(0));
    await tick();
    expect(dongle).toEqual(['waiting', 'ok']);
    await src.disconnect();
    expect(dongle.at(-1)).toBeNull();
  });

  it('첫 LINK는 양손을 다 알리고, 그 뒤엔 바뀐 손만 알린다', async () => {
    const { src, feed, status } = await open();
    feed(link(0b01));
    await tick();
    expect(status).toEqual([
      [0, true, undefined],
      [1, false, undefined],
    ]);
    feed(link(0b01)); // 하트비트: 같으면 조용
    feed(link(0b11));
    feed(link(0b10));
    await tick();
    expect(status.slice(2)).toEqual([
      [1, true, undefined],
      [0, false, undefined],
    ]);
    await src.disconnect();
  });

  it('LINK 뒤 STATUS는 연결을 바꾸지 않고 배터리만, 안 붙은 손 배터리는 붙을 때 함께 알린다', async () => {
    const { src, feed, status } = await open();
    feed(link(0b01));
    await tick();
    status.length = 0;
    feed(statusBytes(0, 82));
    feed(statusBytes(1, 64)); // 오른손은 아직 LINK상 끊김 → 들고 있는다
    await tick();
    expect(status).toEqual([[0, true, 82]]);
    feed(link(0b11));
    await tick();
    expect(status.at(-1)).toEqual([1, true, 64]);
    await src.disconnect();
  });

  it('첫 LINK 전(예전 동글 펌웨어)에는 STATUS를 연결로 본다', async () => {
    const { src, feed, status } = await open();
    feed(statusBytes(1, 50));
    await tick();
    expect(status).toEqual([[1, true, 50]]);
    await src.disconnect();
  });

  it('LINK가 3초 넘게 끊기면 stale + 양손 끊김, 다시 오면 마스크대로 복구', async () => {
    const { src, feed, status, dongle } = await open();
    feed(link(0b11));
    await tick();
    status.length = 0;
    src.checkLinkTimeout(performance.now() + 1000);
    expect(dongle.at(-1)).toBe('ok');
    src.checkLinkTimeout(performance.now() + 3500);
    expect(dongle.at(-1)).toBe('stale');
    expect(status).toEqual([
      [0, false, undefined],
      [1, false, undefined],
    ]);
    feed(link(0b10));
    await tick();
    expect(dongle.at(-1)).toBe('ok');
    expect(status.slice(2)).toEqual([
      [0, false, undefined],
      [1, true, undefined],
    ]);
    await src.disconnect();
  });

  it('다른 동글 연결: 포트 선택을 취소하면 열린 포트를 그대로 둔다', async () => {
    const { src, serial, port } = await open();
    serial.requestPort.mockRejectedValueOnce(new Error('No port selected'));
    await expect(src.connect()).resolves.toBeUndefined();
    expect(src.state).toBe('connected');
    expect(port.close).not.toHaveBeenCalled();
    await src.disconnect();
  });
});

describe('WebSerialStickSource 재연결(비트 5·시계 초기화·reopen·connect 이벤트)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function open() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const live = livePort();
    const serial = stubSerial([live.port]);
    const src = new WebSerialStickSource();
    const status: Array<{ stickId: number; connected: boolean; batteryPct?: number; unconfigured?: boolean }> = [];
    src.subscribe((e) => {
      if (e.kind === 'status') status.push({ stickId: e.stickId, connected: e.connected, batteryPct: e.batteryPct, unconfigured: e.unconfigured });
    });
    await src.autoConnect();
    await vi.advanceTimersByTimeAsync(300); // 포트를 연 직후 SYNC 5회가 끝나게 둔다
    return { src, serial, status, ...live };
  }
  const syncCount = (written: number[][]) => written.filter((w) => w[0] === 0x10).length;
  const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const feedAndSettle = async (feed: (p: Uint8Array) => void, p: Uint8Array, ms = 300) => {
    feed(p);
    await settle(ms);
  };

  it('주기 SYNC는 1초마다 1회 보낸다', async () => {
    const { src, written } = await open();
    const base = syncCount(written);
    await settle(3000);
    expect(syncCount(written) - base).toBe(3);
    await src.disconnect();
  });

  it('동글 순서: LINK 0b01 → STATUS(role 1, 비트 5) → LINK 0b11이면 오른손 연결을 설정 전과 함께 한 번 알리고 SYNC 5회', async () => {
    const { src, feed, written, status } = await open();
    // 주기 SYNC(1초마다)가 세는 구간에 끼지 않게 각 단계를 200ms씩만 돌린다(연속 5회는 200ms 안에 끝난다)
    await feedAndSettle(feed, buildLink({ linkMask: 0b01 }), 200);
    const base = syncCount(written);
    status.length = 0;
    await feedAndSettle(feed, buildStatus({ role: 1, batteryPct: 64, rssi: -50, fwMajor: 2, fwMinor: 1, unconfigured: true }), 200);
    expect(status).toEqual([]); // 안 붙은 손은 보류
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }), 200);
    expect(status).toEqual([{ stickId: 1, connected: true, batteryPct: 64, unconfigured: true }]);
    // 비트 5와 LINK 0→1이 2초 안에 겹쳐도 SYNC는 한 묶음(5회)
    expect(syncCount(written) - base).toBe(5);
    await src.disconnect();
  });

  it('비트 5가 LINK 뒤에 오면 즉시 unconfigured를 실어 알리고 SYNC 5회', async () => {
    const { src, feed, written, status } = await open();
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }));
    await settle(2500); // LINK 0→1 초기화와 2초 이상 떨어뜨린다
    const base = syncCount(written);
    status.length = 0;
    await feedAndSettle(feed, buildStatus({ role: 1, batteryPct: 70, rssi: -50, fwMajor: 2, fwMinor: 1, unconfigured: true }));
    expect(status).toEqual([{ stickId: 1, connected: true, batteryPct: 70, unconfigured: true }]);
    expect(syncCount(written) - base).toBe(5);
    await src.disconnect();
  });

  it('비트 5 = 0인 LINK 0→1은 unconfigured false, 시계 초기화와 SYNC 5회', async () => {
    const { src, feed, written, status } = await open();
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }));
    // 재연결 전에 SYNC_ACK로 offset을 잡아 둔다
    const t0 = written.filter((w) => w[0] === 0x10).at(-1)!;
    const key = new DataView(new Uint8Array(t0).buffer).getUint32(1, true);
    await feedAndSettle(feed, buildSyncAck({ role: 1, t0Ms: key, t1Us: 5_000_000 }), 0);
    expect(src.clockOffsetOf(1)).not.toBeNull();
    await settle(2500);
    await feedAndSettle(feed, buildLink({ linkMask: 0b01 }));
    const base = syncCount(written);
    status.length = 0;
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }), 0);
    expect(status).toEqual([{ stickId: 1, connected: true, batteryPct: undefined, unconfigured: false }]);
    expect(src.clockOffsetOf(1)).toBeNull();
    await settle(300);
    expect(syncCount(written) - base).toBe(5);
    await src.disconnect();
  });

  it('2초 안의 두 번째 트리거는 SYNC를 다시 보내지 않는다', async () => {
    const { src, feed, written } = await open();
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }));
    await settle(2500);
    const base = syncCount(written);
    await feedAndSettle(feed, buildStatus({ role: 0, batteryPct: 70, rssi: -50, fwMajor: 2, fwMinor: 1, unconfigured: true }));
    await feedAndSettle(feed, buildStatus({ role: 0, batteryPct: 70, rssi: -50, fwMajor: 2, fwMinor: 1, unconfigured: true }));
    expect(syncCount(written) - base).toBe(5);
    await src.disconnect();
  });

  it('재부팅한 손은 새 SYNC_ACK로 offset이 바뀐다(옛 bestRtt·랩 상태가 남지 않는다)', async () => {
    const { src, feed, written } = await open();
    const lastKey = () => new DataView(new Uint8Array(written.filter((w) => w[0] === 0x10).at(-1)!).buffer).getUint32(1, true);
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }), 300);
    // 가동 1시간이 넘은 스틱 시계로 offset 설정
    await feedAndSettle(feed, buildSyncAck({ role: 0, t0Ms: lastKey(), t1Us: 3_600_000_000 }), 0);
    const before = src.clockOffsetOf(0)!;
    expect(before).not.toBeNull();
    await settle(2500);
    await feedAndSettle(feed, buildLink({ linkMask: 0b10 })); // 왼손 끊김
    await settle(2500);
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }), 300); // 복귀(재부팅): 시계 0부터
    await settle(60); // 지연이 이전보다 큰 응답
    await feedAndSettle(feed, buildSyncAck({ role: 0, t0Ms: lastKey(), t1Us: 100 }), 0);
    const after = src.clockOffsetOf(0)!;
    expect(after).not.toBeNull();
    expect(Math.abs(after - before)).toBeGreaterThan(3_000_000);
    await src.disconnect();
  });

  it('예전 동글(LINK 없음): STATUS가 오면 그 손 연결을 알린다', async () => {
    const { src, feed, status } = await open();
    await feedAndSettle(feed, buildStatus({ role: 1, batteryPct: 50, rssi: -50, fwMajor: 2, fwMinor: 1 }));
    expect(status).toEqual([{ stickId: 1, connected: true, batteryPct: 50, unconfigured: false }]);
    await src.disconnect();
  });

  it('role 2·3 STATUS·SYNC_ACK는 이벤트를 내지 않는다', async () => {
    const { src, feed, status } = await open();
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 }));
    await settle(2000);
    await feedAndSettle(feed, buildLink({ linkMask: 0b11 })); // 하트비트: 3초 넘게 끊겨 stale이 되지 않게
    status.length = 0;
    const events: unknown[] = [];
    src.subscribe((e) => events.push(e));
    await feedAndSettle(feed, buildStatus({ role: 2, batteryPct: 50, rssi: -50, fwMajor: 2, fwMinor: 1 }));
    await feedAndSettle(feed, buildStatus({ role: 3, batteryPct: 50, rssi: -50, fwMajor: 2, fwMinor: 1, unconfigured: true }));
    await feedAndSettle(feed, buildSyncAck({ role: 2, t0Ms: 1, t1Us: 1000 }));
    expect(events).toEqual([]);
    expect(status).toEqual([]);
    await src.disconnect();
  });

  it('reopen: 포트를 닫고 같은 포트를 다시 열며 양손 끊김을 알린다', async () => {
    const { src, port, status } = await open();
    status.length = 0;
    await src.reopen();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.open).toHaveBeenCalledTimes(2);
    expect(status.slice(0, 2)).toEqual([
      { stickId: 0, connected: false, batteryPct: undefined, unconfigured: undefined },
      { stickId: 1, connected: false, batteryPct: undefined, unconfigured: undefined },
    ]);
    expect(src.state).toBe('connected');
    expect(src.transportStats().reconnects).toBe(1);
    await src.disconnect();

  });

  it('reopen: 포트가 안 열려 있으면 autoConnect와 같다', async () => {
    const live = livePort();
    const serial = stubSerial([live.port]);
    const src = new WebSerialStickSource();
    await src.reopen();
    expect(serial.getPorts).toHaveBeenCalled();
    expect(live.port.open).toHaveBeenCalledOnce();
    expect(src.state).toBe('connected');
    await src.disconnect();
  });

  it('reopen: 다시 열기에 실패해도 던지지 않고 끊김으로 둔다', async () => {
    const { src, port } = await open();
    port.open.mockRejectedValueOnce(new Error('busy'));
    await expect(src.reopen()).resolves.toBeUndefined();
    expect(src.state).toBe('disconnected');
  });

  it('serial connect 이벤트: 포트가 닫혀 있으면 autoConnect로 연다', async () => {
    const live = livePort();
    const serial = stubSerial([]);
    const src = new WebSerialStickSource();
    await src.autoConnect(); // 허락한 포트 없음 → 끊김
    const call = serial.addEventListener.mock.calls.find((c) => c[0] === 'connect');
    expect(call).toBeDefined();
    const handler = call![1] as () => void;
    // 동글을 꽂으면 getPorts가 포트를 돌려준다
    serial.getPorts.mockResolvedValue([live.port]);
    serial.getPorts.mockClear();
    handler();
    await tick();
    expect(serial.getPorts).toHaveBeenCalled();
    expect(live.port.open).toHaveBeenCalledOnce();
    expect(src.state).toBe('connected');
    // 이미 열려 있으면 무시
    handler();
    await tick();
    expect(live.port.open).toHaveBeenCalledOnce();
    // 리스너는 인스턴스당 한 번만 등록한다
    expect(serial.addEventListener.mock.calls.filter((c) => c[0] === 'connect')).toHaveLength(1);
    await src.disconnect();
  });
});

describe('WebSerialStickSource 페달(role 2·3)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function open() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const live = livePort();
    stubSerial([live.port]);
    const src = new WebSerialStickSource();
    const events: Array<Record<string, unknown>> = [];
    src.subscribe((e) => events.push(e as unknown as Record<string, unknown>));
    await src.autoConnect();
    await vi.advanceTimersByTimeAsync(300); // 포트를 연 직후 SYNC 5회가 끝나게 둔다
    const feedAndSettle = async (p: Uint8Array, ms = 300) => {
      live.feed(p);
      await vi.advanceTimersByTimeAsync(ms);
    };
    const pedalEvents = () =>
      events
        .filter((e) => e.kind === 'pedalStatus')
        .map((e) => ({ foot: e.foot, connected: e.connected, batteryPct: e.batteryPct }));
    return { src, events, feedAndSettle, pedalEvents, ...live };
  }
  const syncCount = (written: number[][]) => written.filter((w) => w[0] === 0x10).length;
  const lastKey = (written: number[][]) =>
    new DataView(new Uint8Array(written.filter((w) => w[0] === 0x10).at(-1)!).buffer).getUint32(1, true);
  const stat = (role: 2 | 3, battery: number, unconfigured = false) =>
    buildStatus({ role, batteryPct: battery, rssi: -50, fwMajor: 3, fwMinor: 0, unconfigured });

  // 인수 조건: LINK bit2·bit3 → pedalStatus 연결·끊김
  it('LINK 마스크 0b1111 → 0b1100 → 0b0011 전이에 따라 pedalStatus를 낸다', async () => {
    const { src, feedAndSettle, pedalEvents } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b1111 }));
    expect(pedalEvents()).toEqual([
      { foot: 2, connected: true, batteryPct: undefined },
      { foot: 3, connected: true, batteryPct: undefined },
    ]);
    await feedAndSettle(buildLink({ linkMask: 0b1100 })); // 양손만 빠지면 발은 그대로 → 알림 없음
    expect(pedalEvents()).toHaveLength(2);
    await feedAndSettle(buildLink({ linkMask: 0b0011 })); // 발 둘 끊김
    expect(pedalEvents().slice(2)).toEqual([
      { foot: 2, connected: false, batteryPct: undefined },
      { foot: 3, connected: false, batteryPct: undefined },
    ]);
    await feedAndSettle(buildLink({ linkMask: 0b1100 })); // 발 복귀
    expect(pedalEvents().slice(4)).toEqual([
      { foot: 2, connected: true, batteryPct: undefined },
      { foot: 3, connected: true, batteryPct: undefined },
    ]);
    await src.disconnect();
  });

  // 인수 조건: LINK 0→1 때 그 칸 시계 초기화 + SYNC 5회
  it('발 칸 LINK 0→1에서 그 칸 시계가 초기화되고 SYNC 5회가 나간다', async () => {
    const { src, feedAndSettle, written } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b0100 }));
    await feedAndSettle(buildSyncAck({ role: 2, t0Ms: lastKey(written), t1Us: 5_000_000 }), 0);
    expect(src.clockOffsetOf(2)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2500); // 2초 중복 방지 창 밖
    await feedAndSettle(buildLink({ linkMask: 0b0000 }));
    const base = syncCount(written);
    await feedAndSettle(buildLink({ linkMask: 0b0100 }), 0);
    expect(src.clockOffsetOf(2)).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(syncCount(written) - base).toBe(5);
    await src.disconnect();
  });

  // 인수 조건: 페달 STATUS 배터리 보류 후 붙을 때 알림
  it('발 STATUS가 LINK 전에 오면 보류했다가 붙을 때 배터리와 함께 emit한다', async () => {
    const { src, feedAndSettle, pedalEvents } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b0000 }));
    await feedAndSettle(stat(3, 77));
    expect(pedalEvents().filter((e) => e.connected)).toEqual([]);
    await feedAndSettle(buildLink({ linkMask: 0b1000 }));
    expect(pedalEvents().at(-1)).toEqual({ foot: 3, connected: true, batteryPct: 77 });
    await src.disconnect();
  });

  // 인수 조건: 비트 5는 설정 재전송을 일으키지 않는다
  it('비트 5=1이어도 pedalStatus에 unconfigured가 없고 설정 재전송이 없다', async () => {
    const { src, events, feedAndSettle, written } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b1100 }));
    await vi.advanceTimersByTimeAsync(2500);
    events.length = 0;
    const before = written.length;
    await feedAndSettle(stat(2, 60, true));
    const ped = events.filter((e) => e.kind === 'pedalStatus');
    expect(ped).toHaveLength(1);
    expect(ped[0]).toEqual({ kind: 'pedalStatus', foot: 2, connected: true, batteryPct: 60 });
    expect('unconfigured' in ped[0]).toBe(false);
    // 새로 나간 쓰기는 SYNC(0x10)뿐이다
    expect(written.slice(before).every((w) => w[0] === 0x10)).toBe(true);
    await src.disconnect();
  });

  // 인수 조건: role 2·3 SYNC_ACK가 각 칸 시계 샘플
  it('role 2·3 SYNC_ACK 뒤 clockOffsetOf(2)·clockOffsetOf(3)가 null이 아니다', async () => {
    const { src, feedAndSettle, written } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b1100 }));
    expect(src.clockOffsetOf(2)).toBeNull();
    expect(src.clockOffsetOf(3)).toBeNull();
    const key = lastKey(written);
    await feedAndSettle(buildSyncAck({ role: 2, t0Ms: key, t1Us: 2_000_000 }), 0);
    await feedAndSettle(buildSyncAck({ role: 3, t0Ms: key, t1Us: 2_000_000 }), 0);
    expect(src.clockOffsetOf(2)).not.toBeNull();
    expect(src.clockOffsetOf(3)).not.toBeNull();
    await src.disconnect();
  });

  // 인수 조건: 발 HIT·PEDAL 시각을 그 칸 시계로 환산
  it('발 HIT·PEDAL timestamp가 그 칸 시계 offset으로 환산된다', async () => {
    const { src, events, feedAndSettle, written } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b1100 }));
    const key = lastKey(written);
    await feedAndSettle(buildSyncAck({ role: 3, t0Ms: key, t1Us: 900_000_000 }), 0);
    await feedAndSettle(buildSyncAck({ role: 2, t0Ms: key, t1Us: 1_000_000 }), 0);
    const off3 = src.clockOffsetOf(3)!;
    const off2 = src.clockOffsetOf(2)!;
    expect(off3).not.toBeNull();
    events.length = 0;
    await feedAndSettle(buildHit({ role: 3, seq: 1, timestampUs: 900_500_000, pad: 7, velocity: 100, marginDeg: 25.5 }), 0);
    await feedAndSettle(buildPedal(2, 1, 1_500_000), 0);
    const hit = events.find((e) => e.kind === 'hit')!;
    const pedal = events.find((e) => e.kind === 'pedal')!;
    expect(hit).toMatchObject({ stickId: null, foot: 3, pad: 'KICK' });
    // 환산값 = 보드 ms + 그 칸 offset(ClockSync 오차 허용)
    expect(Math.abs((hit.timestamp as number) - (900_500 + off3))).toBeLessThan(50);
    expect(Math.abs((pedal.timestamp as number) - (1_500 + off2))).toBeLessThan(50);
    await src.disconnect();
  });

  // 인수 조건: LINK 3초 무수신이면 두 발 끊김
  it('LINK 3초 stale에서 pedalStatus{connected:false} 두 발이 나간다', async () => {
    const { src, feedAndSettle, pedalEvents } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b1100 }));
    const n = pedalEvents().length;
    src.checkLinkTimeout(performance.now() + 3500);
    expect(pedalEvents().slice(n)).toEqual([
      { foot: 2, connected: false, batteryPct: undefined },
      { foot: 3, connected: false, batteryPct: undefined },
    ]);
    await src.disconnect();
  });

  // 인수 조건: 포트 닫힘이면 두 발 끊김
  it('cleanup(disconnect)에서 pedalStatus{connected:false} 두 발이 나간다', async () => {
    const { src, feedAndSettle, pedalEvents } = await open();
    await feedAndSettle(buildLink({ linkMask: 0b1100 }));
    const n = pedalEvents().length;
    await src.disconnect();
    expect(pedalEvents().slice(n)).toEqual([
      { foot: 2, connected: false, batteryPct: undefined },
      { foot: 3, connected: false, batteryPct: undefined },
    ]);
  });
});
