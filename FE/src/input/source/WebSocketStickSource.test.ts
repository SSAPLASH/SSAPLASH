// WebSocketStickSource: 링크 1개(기존 동작)와 스틱별 브리지 2링크.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceState, StickEvent, StickStatusEvent } from '@/domain/events';
import { packetTap } from '@/input/packetTap';
import type { PacketRecord } from '@/input/packetTap';
import { encodeHaptic } from '@/input/stickProtocol';
import { WebSocketStickSource, webSocketDescriptor } from './WebSocketStickSource';

/** 테스트용 가짜 WebSocket. 열림·실패·종료·수신을 손으로 일으킨다 */
class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = 0;
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(b: Uint8Array): void {
    this.sent.push(b);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  fail(): void {
    this.readyState = 3;
    this.onerror?.();
    this.onclose?.();
  }
  /** 서버 쪽에서 끊김 */
  drop(): void {
    this.close();
  }
  recv(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
}

/** SYNC_ACK(0x04): role flags, t0 ms, t1 µs */
function syncAck(t0: number, t1Ms: number, role = 0): Uint8Array {
  const b = new Uint8Array(10);
  const v = new DataView(b.buffer);
  b[0] = 0x04;
  b[1] = role;
  v.setUint32(2, t0, true);
  v.setUint32(6, Math.round(t1Ms * 1000), true);
  return b;
}

/** POSE(0x02) 12B */
function pose(role: number, tsUs = 5000): Uint8Array {
  const b = new Uint8Array(12);
  b[0] = 0x02;
  b[1] = role;
  new DataView(b.buffer).setUint32(2, tsUs, true);
  return b;
}

/** 송신된 SYNC(0x10 가정이 아닌 첫 바이트 무관) 프레임의 t0 키 */
function t0Of(sync: Uint8Array): number {
  return new DataView(sync.buffer, sync.byteOffset, sync.byteLength).getUint32(1, true);
}

const isSync = (b: Uint8Array): boolean => b.length === 5;

async function connectAll(src: WebSocketStickSource, open = true): Promise<void> {
  const p = src.connect();
  if (open) for (const ws of FakeWS.instances) ws.open();
  await p;
}

describe('WebSocketStickSource', () => {
  const realWS = (globalThis as { WebSocket?: unknown }).WebSocket;
  let src: WebSocketStickSource;
  let events: StickEvent[];
  let states: { s: SourceState; msg?: string }[];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.instances = [];
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWS;
    src = new WebSocketStickSource();
    events = [];
    states = [];
    src.subscribe((e) => events.push(e));
    src.onState((s, msg) => states.push({ s, msg }));
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { WebSocket?: unknown }).WebSocket = realWS;
  });

  describe('url2 비움(링크 1개)', () => {
    it('링크 1개를 열고 SYNC 5회를 보낸다', async () => {
      src.setUrl('ws://a');
      await connectAll(src);
      expect(FakeWS.instances).toHaveLength(1);
      expect(FakeWS.instances[0].url).toBe('ws://a');
      expect(src.state).toBe('connected');
      vi.advanceTimersByTime(300);
      expect(FakeWS.instances[0].sent.filter(isSync)).toHaveLength(5);
    });

    it('수신 이벤트를 내고, packetTap stickId는 null이다', async () => {
      await connectAll(src);
      const recs: PacketRecord[] = [];
      const off = packetTap.subscribe((r) => recs.push(r));
      FakeWS.instances[0].recv(pose(1));
      vi.advanceTimersByTime(60);
      off();
      expect(events.some((e) => e.kind === 'pose' && e.stickId === 1)).toBe(true);
      const tapped = recs.filter((r) => r.dir === 'in' || r.dir === 'out');
      expect(tapped.length).toBeGreaterThan(0);
      expect(tapped.every((r) => r.stickId === null)).toBe(true);
    });

    it('바이너리 HIT의 seq를 이벤트에 싣는다', async () => {
      await connectAll(src);
      const b = new Uint8Array(20);
      b[0] = 0x01; // HIT
      b[2] = 42; // seq
      FakeWS.instances[0].recv(b);
      expect(events.find((e) => e.kind === 'hit')).toMatchObject({ kind: 'hit', seq: 42 });
    });

    it('공용 링크라 stickId와 상관없이 같은 링크로 보내고 오프셋도 공용이다', async () => {
      await connectAll(src);
      const ws = FakeWS.instances[0];
      vi.advanceTimersByTime(300);
      const t0 = t0Of(ws.sent.filter(isSync)[0]);
      ws.recv(syncAck(t0, 100));
      expect(src.clockOffsetOf(0)).not.toBeNull();
      expect(src.clockOffsetOf(1)).toBe(src.clockOffsetOf(0));
      ws.sent = [];
      src.haptic(1, 100, 100);
      src.sendCommand(new Uint8Array([9]), 0);
      expect(ws.sent).toHaveLength(2);
    });

    it('끊기면 두 손 모두 disconnected status를 낸다', async () => {
      await connectAll(src);
      FakeWS.instances[0].drop();
      const st = events.filter((e): e is StickStatusEvent => e.kind === 'status' && !e.connected).map((e) => e.stickId);
      expect(st.sort()).toEqual([0, 1]);
      expect(src.state).toBe('disconnected');
    });

    it('연결 실패면 error 상태로 reject한다', async () => {
      const p = src.connect();
      FakeWS.instances[0].fail();
      await expect(p).rejects.toThrow();
      expect(src.state).toBe('error');
    });

    it('JSON 메시지 경로는 그대로 동작한다', async () => {
      await connectAll(src);
      FakeWS.instances[0].onmessage?.({
        data: JSON.stringify({ kind: 'hit', stickId: 1, timestamp: 10, peakAccel: 2, pitch: 0, yaw: 0 }),
      });
      expect(events.find((e) => e.kind === 'hit')).toMatchObject({ stickId: 1 });
    });
  });

  describe('url2 설정(링크 2개)', () => {
    beforeEach(() => {
      src.setUrl('ws://left');
      src.setUrl2('ws://right');
    });

    it('두 링크를 만들고 각각 SYNC를 보낸다', async () => {
      await connectAll(src);
      expect(FakeWS.instances.map((w) => w.url)).toEqual(['ws://left', 'ws://right']);
      vi.advanceTimersByTime(300);
      for (const ws of FakeWS.instances) expect(ws.sent.filter(isSync)).toHaveLength(5);
      // 1초 주기 재동기화도 링크마다
      vi.advanceTimersByTime(3000);
      for (const ws of FakeWS.instances) expect(ws.sent.filter(isSync)).toHaveLength(8);
    });

    it('링크별 SYNC_ACK로 손마다 다른 오프셋이 수렴한다', async () => {
      await connectAll(src);
      vi.advanceTimersByTime(300);
      const [l, r] = FakeWS.instances;
      l.recv(syncAck(t0Of(l.sent.filter(isSync)[0]), 1000, 0));
      r.recv(syncAck(t0Of(r.sent.filter(isSync)[0]), 5000, 1));
      const o0 = src.clockOffsetOf(0);
      const o1 = src.clockOffsetOf(1);
      expect(o0).not.toBeNull();
      expect(o1).not.toBeNull();
      expect(Math.abs((o0 as number) - (o1 as number) - 4000)).toBeLessThan(50);
    });

    it('sendCommand(bytes, 1)은 둘째 링크만, stickId 없으면 둘 다', async () => {
      await connectAll(src);
      const [l, r] = FakeWS.instances;
      l.sent = [];
      r.sent = [];
      src.sendCommand(new Uint8Array([0x30, 1]), 1);
      expect(l.sent).toHaveLength(0);
      expect(r.sent).toHaveLength(1);
      src.sendCommand(new Uint8Array([0x30, 2]));
      expect(l.sent).toHaveLength(1);
      expect(r.sent).toHaveLength(2);
    });

    it('haptic(0)은 첫째 링크만, setPoseStream·resetPose는 모든 링크', async () => {
      await connectAll(src);
      const [l, r] = FakeWS.instances;
      l.sent = [];
      r.sent = [];
      src.haptic(0, 100, 100);
      expect(l.sent).toEqual([encodeHaptic(100, 100)]);
      expect(r.sent).toHaveLength(0);
      src.setPoseStream(true);
      src.resetPose();
      expect(l.sent).toHaveLength(3);
      expect(r.sent).toHaveLength(2);
    });

    it('packetTap in/out 기록의 stickId는 링크 hand다', async () => {
      await connectAll(src);
      const recs: PacketRecord[] = [];
      const off = packetTap.subscribe((r) => recs.push(r));
      const [l, r] = FakeWS.instances;
      vi.advanceTimersByTime(60);
      l.recv(pose(0));
      r.recv(pose(1));
      off();
      expect(recs.filter((x) => x.dir === 'out').map((x) => x.stickId)).toContain(0);
      expect(recs.filter((x) => x.dir === 'out').map((x) => x.stickId)).toContain(1);
      const ins = recs.filter((x) => x.dir === 'in');
      expect(ins.map((x) => x.stickId)).toEqual([0, 1]);
    });

    it('한 링크가 끊기면 그 손만 disconnected, 소스는 connected 유지', async () => {
      await connectAll(src);
      FakeWS.instances[1].drop();
      const down = events.filter((e): e is StickStatusEvent => e.kind === 'status' && !e.connected).map((e) => e.stickId);
      expect(down).toEqual([1]);
      expect(src.state).toBe('connected');
      FakeWS.instances[0].drop();
      expect(src.state).toBe('disconnected');
    });

    it('둘째 링크만 연결 실패면 connected + 경고 메시지', async () => {
      const p = src.connect();
      FakeWS.instances[0].open();
      FakeWS.instances[1].fail();
      await p;
      expect(src.state).toBe('connected');
      const last = states[states.length - 1];
      expect(last.s).toBe('connected');
      expect(last.msg).toContain('오른손 브리지 연결 실패');
      expect(last.msg).toContain('ws://right');
    });

    it('둘 다 실패면 error', async () => {
      const p = src.connect();
      for (const ws of FakeWS.instances) ws.fail();
      await expect(p).rejects.toThrow();
      expect(src.state).toBe('error');
    });

    it('role 불일치는 경고 1회, 이벤트 stickId는 패킷 role', async () => {
      await connectAll(src);
      const before = states.length;
      const r = FakeWS.instances[1];
      r.recv(pose(0));
      r.recv(pose(0));
      const warns = states.slice(before).filter((x) => x.msg?.includes('role'));
      expect(warns).toHaveLength(1);
      expect(events.filter((e) => e.kind === 'pose').map((e) => e.stickId)).toEqual([0, 0]);
    });

    it('role이 맞으면 경고하지 않는다', async () => {
      await connectAll(src);
      const before = states.length;
      FakeWS.instances[1].recv(pose(1));
      expect(states.slice(before)).toHaveLength(0);
    });

    it('transportStats.reconnects는 두 링크 합', async () => {
      await connectAll(src);
      FakeWS.instances.length = 0;
      await connectAll(src);
      expect(src.transportStats().reconnects).toBe(2);
    });

    it('disconnect는 모든 링크를 닫는다', async () => {
      await connectAll(src);
      const spy = FakeWS.instances.map((w) => vi.spyOn(w, 'close'));
      await src.disconnect();
      for (const s of spy) expect(s).toHaveBeenCalled();
      expect(src.state).toBe('disconnected');
    });
  });

  describe('autoConnect', () => {
    it('이미 열려 있으면 무동작, 끊긴 뒤에는 connect로 다시 연다', async () => {
      await connectAll(src);
      await src.autoConnect();
      expect(FakeWS.instances).toHaveLength(1);
      FakeWS.instances[0].drop();
      expect(src.state).toBe('disconnected');
      const p = src.autoConnect();
      FakeWS.instances[1].open();
      await p;
      expect(FakeWS.instances).toHaveLength(2);
      expect(src.state).toBe('connected');
    });

    it('연결 실패해도 던지지 않고 상태는 connect가 남긴 error', async () => {
      const p = src.autoConnect();
      FakeWS.instances[0].fail();
      await expect(p).resolves.toBeUndefined();
      expect(src.state).toBe('error');
    });
  });

  describe('디스크립터', () => {
    it('url2 옵션을 반영한다', () => {
      const keys = webSocketDescriptor.options?.map((o) => o.key);
      expect(keys).toEqual(['url', 'url2']);
      expect(webSocketDescriptor.options?.[1].default).toBe('');
      webSocketDescriptor.applyOptions?.(src, { url: 'ws://x', url2: ' ws://y ' });
      void src.connect();
      expect(FakeWS.instances.map((w) => w.url)).toEqual(['ws://x', 'ws://y']);
    });
  });
});
