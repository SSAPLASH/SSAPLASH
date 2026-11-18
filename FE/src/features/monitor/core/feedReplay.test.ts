import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import { packetTap, type PacketRecord } from '@/input/packetTap';
import { encodeSync } from '@/input/stickProtocol';
import { MonitorFeed } from './feed';
import { buildSyncAck } from './mockStick';
import { bytesToHex, type RecordedRow } from './recording/recorder';
import { buildTimeline } from './recording/replay';

const hit = (): ResolvedHit => ({
  id: 7,
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

describe('MonitorFeed replay', () => {
  let clock = 0;
  let feed: MonitorFeed;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 5000;
    feed = new MonitorFeed({ now: () => clock });
  });
  afterEach(() => {
    feed.setMode('direct');
    vi.useRealTimers();
  });
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };
  const recRow = (t: number, byte: number): RecordedRow => ({
    t,
    dir: 'in',
    transport: 'mock',
    stick: 1,
    hex: byte.toString(16).padStart(2, '0'),
    decoded: null,
  });

  it('로컬 탭을 구독하지 않고, 패킷을 재생 시점 기준 시각으로 옮겨 원래 간격대로 전달한다', () => {
    const got: PacketRecord[] = [];
    feed.subscribePacket((r) => got.push(r));
    expect(packetTap.active).toBe(true);
    feed.openReplay(buildTimeline({ rows: [recRow(100, 0xaa), recRow(180, 0xbb)], diags: [] }));
    expect(feed.mode).toBe('replay');
    expect(packetTap.active).toBe(false);
    advance(20);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ dir: 'in', transport: 'mock', stickId: 1, recvTime: 5000 });
    expect(Array.from(got[0].bytes)).toEqual([0xaa]);
    advance(100);
    expect(got).toHaveLength(2);
    expect(got[1].recvTime).toBe(5080); // 간격 80ms 유지
    expect(got[1].id).toBeGreaterThan(got[0].id);
    packetTap.publish({ dir: 'in', transport: 'mock', stickId: 0, bytes: new Uint8Array([1]), recvTime: 5 });
    expect(got).toHaveLength(2);
  });

  it('진단 이벤트의 t와 hit 시각 필드를 같은 차이만큼 옮긴다(hitId는 그대로)', () => {
    const diag: DiagEvent[] = [];
    feed.subscribeDiag((e) => diag.push(e));
    const h = { ...hit(), tHit: 1000, tRecv: 1010, tResolved: 1020, tAudio: 1040 };
    feed.openReplay(
      buildTimeline({
        rows: [],
        diags: [
          { type: 'resolved', t: 1020, hit: h } as DiagEvent,
          { type: 'judged', t: 1050, hitId: h.id } as unknown as DiagEvent,
        ],
      }),
    );
    advance(20); // 재생 시작 시점 5000 = 첫 줄(t 1020) -> d = 3980
    const r = diag[0] as Extract<DiagEvent, { type: 'resolved' }>;
    expect(r.t).toBe(5000);
    expect(r.hit).toMatchObject({ id: h.id, tHit: 4980, tRecv: 4990, tResolved: 5000, tAudio: 5020 });
    advance(40);
    expect(diag).toHaveLength(2);
    expect(diag[1]).toMatchObject({ type: 'judged', hitId: h.id, t: 5030 });
  });

  it('일시정지·배속·처음부터가 전달에 반영되고, 오프셋은 SYNC 짝에서 구해 재생 시각으로 옮긴다', () => {
    const got: PacketRecord[] = [];
    feed.subscribePacket((r) => got.push(r));
    const sync: RecordedRow = {
      t: 100,
      dir: 'out',
      transport: 'mock',
      stick: null,
      hex: bytesToHex(encodeSync(100)),
      decoded: null,
      outType: 0x10,
    };
    const ackRow: RecordedRow = {
      t: 110,
      dir: 'in',
      transport: 'mock',
      stick: 0,
      hex: bytesToHex(buildSyncAck({ t0Ms: 100, t1Us: 50_000 })),
      decoded: null,
    };
    feed.openReplay(buildTimeline({ rows: [sync, ackRow, recRow(300, 7)], diags: [] }));
    expect(feed.replayOffsetOf(0)).toBeNull();
    advance(20);
    expect(got).toHaveLength(2);
    // 녹화 시각 기준 (100 + 110) / 2 - 50 = 55, 마지막으로 낸 줄(t 110)의 이동량 d = 5010 - 110 = 4900
    expect(feed.replayOffsetOf(0)).toBe(55 + 4900);
    feed.replayPause();
    advance(1000);
    expect(got).toHaveLength(2);
    expect(feed.replayStatus()?.state).toBe('paused');
    feed.replayPlay();
    feed.replaySetSpeed(4);
    advance(60); // 위치 20 + 240 > 200 -> 마지막 줄 도달
    expect(got).toHaveLength(3);
    expect(feed.replayStatus()?.state).toBe('ended');
    feed.replayRestart();
    expect(feed.replayOffsetOf(0)).toBeNull(); // 처음부터라 오프셋을 다시 구한다
    advance(20);
    expect(got).toHaveLength(5); // SYNC·ACK 두 줄이 다시 나온다
    expect(feed.replayOffsetOf(0)).not.toBeNull();
  });

  it('다른 모드로 바꾸면 재생이 멈추고 로컬 탭 구독이 돌아온다', () => {
    const got: PacketRecord[] = [];
    feed.subscribePacket((r) => got.push(r));
    feed.openReplay(buildTimeline({ rows: [recRow(0, 1), recRow(500, 2)], diags: [] }));
    advance(20);
    feed.setMode('direct');
    expect(feed.replayStatus()).toBeNull();
    expect(packetTap.active).toBe(true);
    advance(1000);
    expect(got).toHaveLength(1);
  });
});
