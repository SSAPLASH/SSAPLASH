import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagEvent } from '@/engine/diagTap';
import { diagTap } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import { packetTap, type PacketRecord } from '@/input/packetTap';
import { FOLLOW_HIT_ID_BASE, HELLO_TIMEOUT_MS, MonitorFeed, type FeedChannel } from './feed';

class FakeChannel implements FeedChannel {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  postMessage(m: unknown): void {
    this.sent.push(m);
  }
  close(): void {
    this.closed = true;
    this.onmessage = null;
  }
  recv(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const hello = (id: string, origin: number) => ({
  k: 'hello',
  id,
  source: '브리지',
  profileId: null,
  origin,
  offsets: [10, null],
  transport: { crcErrors: 0, resyncCount: 0, droppedBytes: 0, reconnects: 0 },
  audio: { baseMs: 5, outputMs: 15 },
  at: 0,
});
const pkt = (recvTime: number, n = 0): PacketRecord => ({
  id: 99,
  dir: 'in',
  transport: 'mock',
  stickId: 0,
  bytes: new Uint8Array([n]),
  recvTime,
});
const hit = (): ResolvedHit => ({
  id: 1,
  stickId: 0,
  pad: null,
  velocity: 1,
  tHit: 10,
  tRecv: 20,
  tResolved: 30,
  source: 'keyboard',
  pose: { pitch: 0, yaw: 0 },
  peakAccel: 0,
  judgedBy: 'key',
});

describe('MonitorFeed', () => {
  let clock = 0;
  let ch: FakeChannel;
  let feed: MonitorFeed;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1000;
    ch = new FakeChannel();
    // 모니터 창의 timeOrigin = 1000. 연주 창 origin이 1500이면 d = +500
    feed = new MonitorFeed({ createChannel: () => ch, now: () => clock, timeOrigin: () => 1000 });
  });
  afterEach(() => {
    feed.setMode('direct');
    vi.useRealTimers();
  });

  it('direct: packetTap·diagTap을 그대로 전달하고, 구독을 풀면 탭 구독도 사라진다', () => {
    const got: PacketRecord[] = [];
    const diag: DiagEvent[] = [];
    const off1 = feed.subscribePacket((r) => got.push(r));
    const off2 = feed.subscribeDiag((e) => diag.push(e));
    packetTap.publish({ dir: 'in', transport: 'mock', stickId: 0, bytes: new Uint8Array([1]), recvTime: 5 });
    diagTap.publish({ type: 'resolved', hit: hit() });
    expect(got).toHaveLength(1);
    expect(got[0].recvTime).toBe(5);
    expect(diag).toHaveLength(1);
    off1();
    off2();
    expect(packetTap.active).toBe(false);
    expect(diagTap.active).toBe(false);
  });

  it('follow: 로컬 탭은 무시하고(구독 해제) 즉시·1초마다 watch를 보낸다', () => {
    const got: PacketRecord[] = [];
    feed.subscribePacket((r) => got.push(r));
    feed.setMode('follow');
    expect(packetTap.active).toBe(false);
    packetTap.publish({ dir: 'in', transport: 'mock', stickId: 0, bytes: new Uint8Array([1]), recvTime: 5 });
    expect(got).toHaveLength(0);
    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0]).toMatchObject({ k: 'watch' });
    vi.advanceTimersByTime(3000);
    expect(ch.sent).toHaveLength(4);
    // 연주 창이 새로 뜨면(ready) 주기를 기다리지 않고 바로 watch
    ch.recv({ k: 'ready' });
    expect(ch.sent).toHaveLength(5);
    expect(ch.sent[4]).toMatchObject({ k: 'watch' });
    // direct로 돌아오면 채널을 닫고 탭을 다시 구독한다
    feed.setMode('direct');
    expect(ch.closed).toBe(true);
    expect(packetTap.active).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(ch.sent).toHaveLength(5);
  });

  it('follow: 첫 hello 전 batch는 버린다', () => {
    const got: PacketRecord[] = [];
    feed.subscribePacket((r) => got.push(r));
    feed.setMode('follow');
    ch.recv({ k: 'batch', id: 'a', items: [{ k: 'packet', rec: pkt(100) }] });
    expect(got).toHaveLength(0);
    ch.recv(hello('a', 1500));
    ch.recv({ k: 'batch', id: 'a', items: [{ k: 'packet', rec: pkt(100) }] });
    expect(got).toHaveLength(1);
  });

  it('follow: 시각을 d만큼 옮긴 복사본을 주고 id는 새로 매긴다', () => {
    const got: PacketRecord[] = [];
    const diag: DiagEvent[] = [];
    feed.subscribePacket((r) => got.push(r));
    feed.subscribeDiag((e) => diag.push(e));
    feed.setMode('follow');
    ch.recv(hello('a', 1500)); // d = 500
    const rec = pkt(100, 7);
    const h = hit();
    const ev: DiagEvent = { type: 'resolved', hit: h, t: 40 };
    const evAudio: DiagEvent = { type: 'resolved', hit: { ...hit(), tAudio: 50 }, t: 41 };
    const judged: DiagEvent = {
      type: 'judged',
      hitId: 1,
      judgement: 'PERFECT',
      noteIndex: 0,
      notePad: null,
      hitPad: null,
      deltaMs: 1,
      songTimeMs: 9,
      t: 60,
    };
    ch.recv({
      k: 'batch',
      id: 'a',
      items: [
        { k: 'packet', rec },
        { k: 'packet', rec: pkt(110) },
        { k: 'diag', ev },
        { k: 'diag', ev: evAudio },
        { k: 'diag', ev: judged },
      ],
    });
    expect(got.map((r) => r.id)).toEqual([1, 2]);
    expect(got[0].recvTime).toBe(600);
    expect(got[0]).not.toBe(rec);
    expect(rec.recvTime).toBe(100); // 원본 불변
    const r0 = diag[0] as Extract<DiagEvent, { type: 'resolved' }>;
    expect([r0.t, r0.hit.tHit, r0.hit.tRecv, r0.hit.tResolved, r0.hit.tAudio]).toEqual([540, 510, 520, 530, undefined]);
    expect(h.tHit).toBe(10);
    expect((diag[1] as Extract<DiagEvent, { type: 'resolved' }>).hit.tAudio).toBe(550);
    expect(diag[2].t).toBe(560);
    expect(feed.followStatus().offsets).toEqual([510, null]);
  });

  it('follow: 연주 창이 다시 떠 hitId가 1부터 반복돼도 모니터 안에서는 겹치지 않고, 판정은 자기 타격 id를 따른다', () => {
    const diag: DiagEvent[] = [];
    feed.subscribeDiag((e) => diag.push(e));
    feed.setMode('follow');
    const judged = (hitId: number): DiagEvent => ({
      type: 'judged',
      hitId,
      judgement: 'GOOD',
      noteIndex: 0,
      notePad: null,
      hitPad: null,
      deltaMs: 1,
      songTimeMs: 0,
      t: 1,
    });
    const run = (win: string) => {
      ch.recv(hello(win, 1000));
      ch.recv({ k: 'batch', id: win, items: [{ k: 'diag', ev: { type: 'resolved', hit: hit(), t: 0 } }, { k: 'diag', ev: judged(1) }] });
    };
    run('a');
    run('b'); // 새로고침한 연주 창: 원래 hitId 1이 다시 온다
    const ids = diag.map((e) => (e.type === 'resolved' ? e.hit.id : e.type === 'judged' ? e.hitId : null));
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
    expect(ids[0]).toBeGreaterThanOrEqual(FOLLOW_HIT_ID_BASE);
  });

  it('follow: 가장 최근 hello의 id만 따르고 다른 id의 batch는 버린다', () => {
    const got: PacketRecord[] = [];
    feed.subscribePacket((r) => got.push(r));
    feed.setMode('follow');
    ch.recv(hello('a', 1500));
    ch.recv({ k: 'batch', id: 'a', items: [{ k: 'packet', rec: pkt(1) }] });
    ch.recv(hello('b', 2000)); // d = 1000
    ch.recv({ k: 'batch', id: 'a', items: [{ k: 'packet', rec: pkt(2) }] });
    ch.recv({ k: 'batch', id: 'b', items: [{ k: 'packet', rec: pkt(3) }] });
    expect(got.map((r) => r.recvTime)).toEqual([501, 1003]);
    expect(feed.followStatus().windowId).toBe('b');
  });

  it('follow: hello가 3초 안 오면 연주 창 없음', () => {
    feed.setMode('follow');
    expect(feed.followStatus()).toMatchObject({ connected: false, helloAgeMs: null, source: null });
    ch.recv(hello('a', 1500));
    expect(feed.followStatus()).toMatchObject({ connected: true, source: '브리지', helloAgeMs: 0, audio: { baseMs: 5, outputMs: 15 } });
    clock += HELLO_TIMEOUT_MS - 1;
    expect(feed.followStatus().connected).toBe(true);
    clock += 1;
    expect(feed.followStatus().connected).toBe(false);
    expect(feed.followStatus().helloAgeMs).toBe(HELLO_TIMEOUT_MS);
    ch.recv(hello('a', 1500));
    expect(feed.followStatus().connected).toBe(true);
  });
});
