import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagTap } from '@/engine/diagTap';
import { packetTap } from '@/input/packetTap';
import { startMonitorRelay, WATCH_TTL_MS, type ChannelLike, type RelayInfo } from './monitorRelay';

class FakeChannel implements ChannelLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: { k: string; [key: string]: unknown }[] = [];
  closed = false;
  postMessage(m: unknown): void {
    // 실제 채널처럼 보낼 때 복제한다
    this.sent.push(structuredClone(m) as { k: string });
  }
  close(): void {
    this.closed = true;
  }
  /** 모니터 쪽에서 온 메시지 */
  recv(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const info: RelayInfo = {
  source: 'WebSocket 브리지',
  profileId: null,
  offsets: [12.5, null],
  transport: { crcErrors: 1, resyncCount: 2, droppedBytes: 3, reconnects: 4 },
  audio: { baseMs: 10, outputMs: 20 },
};

const pub = (n = 1) =>
  packetTap.publish({ dir: 'in', transport: 'mock', stickId: 0, bytes: new Uint8Array([1, 2, n]), recvTime: 100 + n });

describe('monitorRelay', () => {
  let ch: FakeChannel;
  let stop: (() => void) | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    ch = new FakeChannel();
  });
  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });
  const start = (pathname = '/play') => {
    stop = startMonitorRelay({
      getInfo: () => info,
      createChannel: () => ch,
      pathname: () => pathname,
      timeOrigin: () => 5000,
      now: () => 42,
    });
    // 시작 알림(ready)은 아래 전용 테스트에서 본다
    ch.sent = ch.sent.filter((m) => m.k !== 'ready');
  };

  it('시작하면 ready를 한 번 보낸다(/monitor 경로는 보내지 않음)', () => {
    stop = startMonitorRelay({ getInfo: () => info, createChannel: () => ch, pathname: () => '/play' });
    expect(ch.sent).toEqual([{ k: 'ready' }]);
    stop();
    ch = new FakeChannel();
    stop = startMonitorRelay({ getInfo: () => info, createChannel: () => ch, pathname: () => '/monitor/stick' });
    expect(ch.sent).toEqual([]);
  });

  it('watch가 없으면 탭을 구독하지 않고 아무것도 보내지 않는다', () => {
    start();
    expect(packetTap.active).toBe(false);
    expect(diagTap.active).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(ch.sent).toEqual([]);
  });

  it('watch를 받으면 구독하고 hello를 먼저 보낸다(필드 포함)', () => {
    start();
    ch.recv({ k: 'watch', at: 1 });
    expect(packetTap.active).toBe(true);
    expect(diagTap.active).toBe(true);
    expect(ch.sent).toHaveLength(1);
    const h = ch.sent[0];
    expect(h).toMatchObject({
      k: 'hello',
      source: 'WebSocket 브리지',
      profileId: null,
      origin: 5000,
      offsets: [12.5, null],
      transport: info.transport,
      audio: info.audio,
      at: 42,
    });
    expect(typeof h.id).toBe('string');
    // 1초마다 hello, id는 같다
    vi.advanceTimersByTime(1000);
    const hellos = ch.sent.filter((m) => m.k === 'hello');
    expect(hellos.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hellos.map((m) => m.id)).size).toBe(1);
  });

  it('이벤트를 50ms마다 한 묶음으로 보내고, 보낼 때 복제하므로 나중에 채운 tAudio가 실린다', () => {
    start();
    ch.recv({ k: 'watch', at: 1 });
    ch.sent.length = 0;
    pub(1);
    pub(2);
    const hit = {
      id: 1,
      stickId: 0 as const,
      pad: null,
      velocity: 1,
      tHit: 1,
      tRecv: 2,
      tResolved: 3,
      source: 'keyboard',
      pose: { pitch: 0, yaw: 0 },
      peakAccel: 0,
      judgedBy: 'key' as const,
      tAudio: undefined as number | undefined,
    };
    diagTap.publish({ type: 'resolved', hit });
    hit.tAudio = 77; // publish 뒤에 채워짐
    vi.advanceTimersByTime(49);
    expect(ch.sent.filter((m) => m.k === 'batch')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const batches = ch.sent.filter((m) => m.k === 'batch');
    expect(batches).toHaveLength(1);
    expect(typeof batches[0].id).toBe('string');
    const items = batches[0].items as { k: string; ev?: { hit: { tAudio?: number } } }[];
    expect(items.map((i) => i.k)).toEqual(['packet', 'packet', 'diag']);
    expect(items[2].ev?.hit.tAudio).toBe(77);
    // 비어 있으면 보내지 않는다
    vi.advanceTimersByTime(500);
    expect(ch.sent.filter((m) => m.k === 'batch')).toHaveLength(1);
  });

  it('마지막 watch 후 3초가 지나면 구독을 풀고 타이머를 정리한다', () => {
    start();
    ch.recv({ k: 'watch', at: 1 });
    vi.advanceTimersByTime(WATCH_TTL_MS - 1);
    ch.recv({ k: 'watch', at: 2 }); // 연장
    vi.advanceTimersByTime(WATCH_TTL_MS - 1);
    expect(packetTap.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(packetTap.active).toBe(false);
    expect(diagTap.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const n = ch.sent.length;
    vi.advanceTimersByTime(5000);
    expect(ch.sent.length).toBe(n);
    // 다시 watch하면 재개
    ch.recv({ k: 'watch', at: 3 });
    expect(packetTap.active).toBe(true);
  });

  it('/monitor 경로의 창은 watch에 응답하지 않는다', () => {
    start('/monitor/stick');
    ch.recv({ k: 'watch', at: 1 });
    expect(packetTap.active).toBe(false);
    expect(ch.sent).toEqual([]);
  });

  it('경로는 watch를 받을 때 본다(모니터에서 연주 화면으로 옮긴 창도 응답)', () => {
    let path = '/monitor/stick';
    stop = startMonitorRelay({ getInfo: () => info, createChannel: () => ch, pathname: () => path, timeOrigin: () => 5000, now: () => 42 });
    ch.recv({ k: 'watch', at: 1 });
    expect(packetTap.active).toBe(false);
    path = '/play';
    ch.recv({ k: 'watch', at: 2 });
    ch.sent = ch.sent.filter((m) => m.k !== 'ready');
    expect(packetTap.active).toBe(true);
    expect(ch.sent[0]).toMatchObject({ k: 'hello' });
  });

  it('정지하면 구독·채널·타이머를 정리한다', () => {
    start();
    ch.recv({ k: 'watch', at: 1 });
    stop?.();
    expect(packetTap.active).toBe(false);
    expect(ch.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
