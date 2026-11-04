import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedHit } from '@/domain/events';
import type { DiagEvent } from '@/engine/diagTap';
import type { PacketRecord } from '@/input/packetTap';
import { JUDGE_WAIT_MS, TelemetryCollector, type EventSink } from './collector';
import type { TelemetryEvent, TelemetryMode } from './wire';

interface Pushed {
  sessionId: string;
  mode: TelemetryMode;
  event: TelemetryEvent;
}

function setup() {
  const pushed: Pushed[] = [];
  const sink: EventSink = { push: (sessionId, mode, event) => pushed.push({ sessionId, mode, event }) };
  let diagFn: ((e: DiagEvent) => void) | null = null;
  let packetFn: ((r: PacketRecord) => void) | null = null;
  let n = 0;
  const unsubDiag = vi.fn(() => (diagFn = null));
  const unsubPacket = vi.fn(() => (packetFn = null));
  const c = new TelemetryCollector({
    sink,
    diag: { subscribe: (f) => ((diagFn = f), unsubDiag) },
    packets: { subscribe: (f) => ((packetFn = f), unsubPacket) },
    randomUUID: () => `uuid-${++n}`,
    timeOrigin: 0,
  });
  const diag = (body: Record<string, unknown>) => diagFn?.({ t: 0, ...body } as unknown as DiagEvent);
  const packet = (bytes: number[], stickId: 0 | 1 | null = 0, recvTime = 0) =>
    packetFn?.({ id: 1, dir: 'in', transport: 'ble', stickId, bytes: new Uint8Array(bytes), recvTime });
  return { c, pushed, diag, packet, unsubDiag, unsubPacket };
}

function hit(id: number, p: Partial<ResolvedHit> = {}): ResolvedHit {
  return {
    id,
    stickId: 0,
    pad: 'SNARE',
    velocity: 90,
    tHit: 100,
    tRecv: 100,
    tResolved: 101,
    source: 'keyboard',
    pose: { pitch: 0, yaw: 0 },
    peakAccel: 1,
    judgedBy: 'key',
    ...p,
  };
}

const sessionStart = (mode: 'RHYTHM' | 'SHEET' = 'RHYTHM') => ({ type: 'session', phase: 'start', mode });
const judged = (hitId: number, judgement: string | null, deltaMs: number | null) => ({
  type: 'judged',
  hitId,
  judgement,
  deltaMs,
});

/** HIT 20바이트. role 0 = 왼손 */
function hitPacket(seq: number, flags = 0): number[] {
  const b = new Array(20).fill(0);
  b[0] = 0x01;
  b[1] = flags;
  b[2] = seq;
  return b;
}

/** STATUS 6바이트 */
function statusPacket(opts: { flags?: number; battery?: number; fwMajor?: number; fwMinor?: number } = {}): number[] {
  return [0x03, opts.flags ?? 0, opts.battery ?? 0xff, 0xc0, opts.fwMajor ?? 1, opts.fwMinor ?? 0];
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TelemetryCollector 세션 UUID', () => {
  it('세션 밖 이벤트는 인스턴스당 진단 UUID와 mode null', () => {
    const { c, pushed, diag } = setup();
    c.start();
    diag({ type: 'resolved', hit: hit(1) });
    diag({ type: 'resolved', hit: hit(2) });
    vi.advanceTimersByTime(JUDGE_WAIT_MS);
    expect(pushed.map((p) => [p.sessionId, p.mode])).toEqual([
      ['uuid-1', null],
      ['uuid-1', null],
    ]);
  });

  it('session start에서 새 UUID를 만들고 end까지 유지, pause·resume도 같은 UUID', () => {
    const { c, pushed, diag } = setup();
    c.start();
    diag(sessionStart('SHEET'));
    const id = c.currentSessionId();
    expect(c.currentMode()).toBe('SHEET');
    diag({ type: 'session', phase: 'pause', mode: 'SHEET' });
    diag({ type: 'session', phase: 'resume', mode: 'SHEET' });
    expect(c.currentSessionId()).toBe(id);
    diag({ type: 'resolved', hit: hit(1) });
    diag(judged(1, 'PERFECT', 3));
    expect(pushed[0]).toMatchObject({ sessionId: id, mode: 'SHEET' });
    diag({ type: 'session', phase: 'end', mode: 'SHEET' });
    expect(c.currentMode()).toBeNull();
    expect(c.currentSessionId()).not.toBe(id);
  });

  it('세션이 새로 시작하면 이전과 다른 UUID', () => {
    const { c, diag } = setup();
    c.start();
    diag(sessionStart());
    const a = c.currentSessionId();
    diag({ type: 'session', phase: 'end', mode: 'RHYTHM' });
    diag(sessionStart());
    expect(c.currentSessionId()).not.toBe(a);
  });

  it('타격은 resolved 시점의 세션에 속한다(판정이 늦게 와도)', () => {
    const { c, pushed, diag } = setup();
    c.start();
    diag(sessionStart());
    const id = c.currentSessionId();
    diag({ type: 'resolved', hit: hit(1) });
    diag({ type: 'session', phase: 'end', mode: 'RHYTHM' });
    vi.advanceTimersByTime(JUDGE_WAIT_MS);
    expect(pushed[0]).toMatchObject({ sessionId: id, mode: 'RHYTHM' });
  });
});

describe('TelemetryCollector resolved ↔ judged 짝', () => {
  it('judged가 오면 judgement·deltaMs를 채워 바로 큐에 넣는다', () => {
    const { c, pushed, diag } = setup();
    c.start();
    diag({ type: 'resolved', hit: hit(7) });
    expect(pushed).toHaveLength(0);
    diag(judged(7, 'GOOD', -12.5));
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event).toMatchObject({ kind: 'HIT', judgement: 'GOOD', deltaMs: -12.5 });
    // 시간 초과 타이머가 한 번 더 넣지 않는다
    vi.advanceTimersByTime(1000);
    expect(pushed).toHaveLength(1);
  });

  it('300ms 안에 judged가 없으면 judgement·deltaMs null로 넣는다', () => {
    const { c, pushed, diag } = setup();
    c.start();
    diag({ type: 'resolved', hit: hit(7) });
    vi.advanceTimersByTime(JUDGE_WAIT_MS - 1);
    expect(pushed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(pushed[0].event).toMatchObject({ judgement: null, deltaMs: null });
  });

  it('채보 밖 타격(judgement null)과 MISS는 deltaMs null', () => {
    const { c, pushed, diag } = setup();
    c.start();
    diag({ type: 'resolved', hit: hit(1) });
    diag(judged(1, null, 5));
    diag({ type: 'resolved', hit: hit(2) });
    diag(judged(2, 'MISS', 200));
    expect(pushed.map((p) => p.event)).toMatchObject([
      { judgement: null, deltaMs: null },
      { judgement: 'MISS', deltaMs: null },
    ]);
  });

  it('모르는 hitId의 judged는 무시, 큐에 넣는 시점의 hit 값(tAudio)을 읽는다', () => {
    const { c, pushed, diag } = setup();
    c.start();
    diag(judged(99, 'PERFECT', 0));
    expect(pushed).toHaveLength(0);
    const h = hit(1);
    diag({ type: 'resolved', hit: h });
    h.tAudio = 105;
    diag(judged(1, 'PERFECT', 0));
    expect(pushed[0].event).toMatchObject({ tAudio: 105 });
  });

  it('stop()하면 구독을 해제하고 판정 대기 중인 타격은 판정 null로 넣는다', () => {
    const { c, pushed, diag, unsubDiag, unsubPacket } = setup();
    c.start();
    diag({ type: 'resolved', hit: hit(1) });
    c.stop();
    expect(unsubDiag).toHaveBeenCalled();
    expect(unsubPacket).toHaveBeenCalled();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event).toMatchObject({ judgement: null });
    expect(c.running).toBe(false);
    // 다시 시작해도 된다
    c.start();
    expect(c.running).toBe(true);
  });
});

describe('TelemetryCollector STATUS·packetLoss', () => {
  it('STATUS 패킷: stickId는 packet stickId, battery 0xFF는 null, 펌웨어·소스 tags', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(statusPacket(), 1, 50);
    expect(pushed[0].event).toMatchObject({
      kind: 'STATUS',
      stickId: 1,
      batteryPct: null,
      packetLoss: null,
      tags: { source: 'ble', connected: true, firmware: '1.0' },
    });
  });

  it('setActiveSource가 있으면 tags.source로 쓴다', () => {
    const { c, pushed, packet } = setup();
    c.start();
    c.setActiveSource('pointer');
    packet(statusPacket(), 0);
    expect(pushed[0].event.tags.source).toBe('pointer');
  });

  it('packet stickId가 없으면(직렬) STATUS 본문 role로 정하고, 못 정하면 버린다', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(statusPacket({ flags: 1 }), null);
    expect(pushed[0].event).toMatchObject({ stickId: 1 });
    packet(statusPacket({ flags: 2 }), null);
    expect(pushed).toHaveLength(1);
  });

  it('battery 값이 있으면 그대로', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(statusPacket({ battery: 87 }), 0);
    expect(pushed[0].event).toMatchObject({ batteryPct: 87 });
  });

  it('packetLoss: 직전 STATUS 이후 seq 건너뛴 수 ÷ (받은 + 건너뛴), 구간마다 초기화', () => {
    const { c, pushed, packet } = setup();
    c.start();
    // seq 1,2,5,6 → 받은 4, 건너뛴 2(3·4)
    for (const s of [1, 2, 5, 6]) packet(hitPacket(s), 0);
    packet(statusPacket(), 0);
    expect(pushed[0].event.packetLoss).toBeCloseTo(2 / 6);
    // 다음 구간: 7, 8 → 손실 0
    for (const s of [7, 8]) packet(hitPacket(s), 0);
    packet(statusPacket(), 0);
    expect(pushed[1].event.packetLoss).toBe(0);
  });

  it('구간에 HIT가 0건이면 packetLoss null', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(hitPacket(1), 0);
    packet(statusPacket(), 0);
    packet(statusPacket(), 0);
    expect(pushed[1].event.packetLoss).toBeNull();
  });

  it('seq는 u8 순환: 254 → 1은 건너뛴 2(255·0)', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(hitPacket(254), 0);
    packet(hitPacket(1), 0);
    packet(statusPacket(), 0);
    expect(pushed[0].event.packetLoss).toBeCloseTo(2 / 4);
  });

  it('구간 경계를 넘는 누락도 센다(STATUS 뒤 첫 HIT가 건너뜀)', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(hitPacket(10), 0);
    packet(statusPacket(), 0);
    packet(hitPacket(13), 0);
    packet(statusPacket(), 0);
    expect(pushed[1].event.packetLoss).toBeCloseTo(2 / 3);
  });

  it('스틱별로 따로 센다', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(hitPacket(1), 0);
    packet(hitPacket(5), 1);
    packet(hitPacket(2), 0);
    packet(hitPacket(6), 1);
    packet(statusPacket(), 0);
    packet(statusPacket(), 1);
    expect(pushed[0].event.packetLoss).toBe(0);
    expect(pushed[1].event.packetLoss).toBe(0);
  });

  it('송신(out) 패킷과 모르는 패킷은 무시', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet([0x7f, 0, 0, 0]);
    expect(pushed).toHaveLength(0);
  });

  it('STATUS 뒤 HIT 이벤트 tags.firmware에 마지막 펌웨어 버전이 실린다', () => {
    const { c, pushed, packet, diag } = setup();
    c.start();
    packet(statusPacket({ fwMajor: 1, fwMinor: 2 }), 0);
    diag({ type: 'resolved', hit: hit(1) });
    diag(judged(1, 'PERFECT', 0));
    expect(pushed[1].event.tags).toMatchObject({ firmware: '1.2' });
  });
});

describe('TelemetryCollector 연결 상태 알림', () => {
  it('notifyConnection은 connected 값을 담은 STATUS를 만든다', () => {
    const { c, pushed } = setup();
    c.start();
    c.notifyConnection(1, false, 'ble', 10);
    expect(pushed[0].event).toMatchObject({ kind: 'STATUS', stickId: 1, tags: { source: 'ble', connected: false }, packetLoss: null });
  });

  it('연결이 바뀌면 seq 집계를 비운다(재부팅 직후 seq 0으로 시작해도 손실로 세지 않는다)', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(hitPacket(200), 0);
    c.notifyConnection(0, false, 'ble');
    packet(hitPacket(3), 0);
    packet(statusPacket(), 0);
    expect(pushed[1].event.packetLoss).toBe(0);
  });
});

describe('TelemetryCollector 페달(손 없는 타격, PLAY-002)', () => {
  // 인수 조건: 페달 타격이 텔레메트리에 들어간다(firmware null)
  it('stickId null 센서 타격은 firmware null·stickId null로 큐에 들어간다', () => {
    const { c, pushed, packet, diag } = setup();
    c.start();
    packet(statusPacket({ fwMajor: 1, fwMinor: 2 }), 0); // 손 펌웨어가 있어도 페달에는 실리지 않는다
    diag({ type: 'resolved', hit: hit(1, { stickId: null, foot: 3, pad: 'KICK', source: 'webserial', judgedBy: 'stick' }) });
    diag(judged(1, 'PERFECT', 0));
    const ev = pushed.at(-1)!.event;
    expect(ev).toMatchObject({ kind: 'HIT', stickId: null, pad: 'KICK' });
    expect(ev.tags.firmware ?? null).toBeNull();
  });

  // 인수 조건: 손 통계 제외
  it('role 2·3 HIT·STATUS 패킷은 손 seq 통계·STATUS 이벤트에 들어가지 않는다', () => {
    const { c, pushed, packet } = setup();
    c.start();
    packet(hitPacket(10), null);
    packet(hitPacket(40, 3), null); // 킥: 손 seq 집계에서 제외
    packet(hitPacket(50, 2), null);
    packet(statusPacket({ flags: 3 }), null); // 발 STATUS는 이벤트 없음
    expect(pushed).toHaveLength(0);
    packet(hitPacket(11), null);
    packet(statusPacket(), null);
    expect(pushed[0].event.packetLoss).toBe(0); // 손 seq 10→11만 센다
  });
});
