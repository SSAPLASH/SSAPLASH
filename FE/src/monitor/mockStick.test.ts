import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeGetParams, encodeSetParam, encodeSetPadTable, decodePacket, encodeSync, STICK_PARAMS, PAD_CODE } from '@/input/stickProtocol';
import { packetTap, type PacketRecord } from '@/input/packetTap';
import {
  buildBridgeStats,
  buildHit,
  buildLog,
  buildParamAck,
  buildPose,
  buildStatus,
  buildSyncAck,
  MockStick,
} from './mockStick';

describe('빌더 왕복', () => {
  it('HIT', () => {
    const b = buildHit({
      role: 1,
      seq: 7,
      timestampUs: 0xfffffff0,
      pad: PAD_CODE.SNARE,
      marginDeg: 3.5,
      elevationDeg: 12.34,
      azimuthDeg: -45.6,
      peakSpeedDps: 640,
      velocity: 90,
      swingMs: 120,
      lateralDeg: -2.5,
      decel: 8.5,
      magAnomaly: true,
      ambiguous: true,
    });
    expect(b.length).toBe(20);
    expect(decodePacket(b, 1)).toEqual({
      kind: 'hit',
      recvTime: 1,
      flags: 0x19,
      role: 1,
      magAnomaly: true,
      ambiguous: true,
      seq: 7,
      timestampUs: 0xfffffff0,
      pad: 'SNARE',
      marginDeg: 3.5,
      elevationDeg: 12.34,
      azimuthDeg: -45.6,
      peakSpeedDps: 640,
      velocity: 90,
      swingMs: 120,
      lateralDeg: -2.5,
      decel: 8.5,
    });
    expect(decodePacket(buildHit({ seq: 0, timestampUs: 0, pad: 0xff }), 0)).toMatchObject({ pad: null });
  });

  it('POSE 13B·12B', () => {
    const f = { role: 1 as const, timestampUs: 5000, elevationDeg: -1.5, azimuthDeg: 20.25, rollDeg: 3 };
    expect(decodePacket(buildPose({ ...f, seq: 9 }), 0)).toMatchObject({ kind: 'pose', ...f, seq: 9 });
    const b = buildPose({ ...f, seq: null });
    expect(b.length).toBe(12);
    expect(decodePacket(b, 0)).toMatchObject({ seq: null });
  });

  it('STATUS', () => {
    expect(decodePacket(buildStatus({ role: 1, batteryPct: 80, rssi: -60, fwMajor: 1, fwMinor: 2 }), 0)).toMatchObject({
      kind: 'status',
      role: 1,
      batteryPct: 80,
      rssi: -60,
      fwMajor: 1,
      fwMinor: 2,
    });
    expect(decodePacket(buildStatus({ batteryPct: null, rssi: 0, fwMajor: 0, fwMinor: 1 }), 0)).toMatchObject({ batteryPct: null });
  });

  it('SYNC_ACK', () => {
    expect(decodePacket(buildSyncAck({ t0Ms: 1234, t1Us: 99999 }), 0)).toMatchObject({ kind: 'syncAck', t0Ms: 1234, t1Us: 99999 });
  });

  it('BRIDGE_STATS', () => {
    expect(decodePacket(buildBridgeStats({ okFrames: 100, crcErrors: 2, resyncCount: 3 }), 0)).toMatchObject({
      kind: 'bridgeStats',
      okFrames: 100,
      crcErrors: 2,
      resyncCount: 3,
    });
  });

  it('LOG', () => {
    expect(decodePacket(buildLog('BOOT 0.1 abc', 1), 0)).toMatchObject({ kind: 'log', role: 1, text: 'BOOT 0.1 abc' });
  });

  it('PARAM_ACK', () => {
    expect(decodePacket(buildParamAck({ role: 1, paramId: 0x20, value: -300 }), 0)).toMatchObject({
      kind: 'paramAck',
      role: 1,
      paramId: 0x20,
      value: -300,
    });
  });
});

describe('MockStick', () => {
  let got: PacketRecord[];
  let off: () => void;
  let mock: MockStick;

  beforeEach(() => {
    vi.useFakeTimers();
    got = [];
    off = packetTap.subscribe((r) => got.push(r));
    mock = new MockStick();
  });
  afterEach(() => {
    mock.stop();
    off();
    vi.useRealTimers();
  });

  const kinds = () => got.map((r) => (r.dir === 'out' ? 'out' : decodePacket(r.bytes, 0).kind));
  const count = (k: string) => kinds().filter((x) => x === k).length;

  it('시작 시 BOOT 로그, 1초 동안 POSE ≈ 50·HIT 1·BRIDGE_STATS 1', () => {
    mock.start();
    expect(mock.running).toBe(true);
    expect(decodePacket(got[0].bytes, 0)).toMatchObject({ kind: 'log', text: 'BOOT 0.1 mock000' });
    vi.advanceTimersByTime(1000);
    expect(count('pose')).toBe(50);
    expect(count('hit')).toBe(1);
    expect(count('bridgeStats')).toBe(1);
    expect(got.every((r) => r.transport === 'mock')).toBe(true);
  });

  it('10번째 HIT는 seq를 1 건너뛰고 50번째는 19바이트 오류 패킷', () => {
    mock.start({ hitIntervalMs: 100, poseHz: 1 });
    vi.advanceTimersByTime(100 * 50);
    const hits = got.filter((r) => r.dir === 'in' && r.bytes[0] === 0x01);
    expect(hits.length).toBe(50);
    const seqs = hits.map((r) => r.bytes[2]);
    expect(seqs[9] - seqs[8]).toBe(2);
    expect(seqs[8] - seqs[7]).toBe(1);
    expect(hits[49].bytes.length).toBe(19);
    expect(decodePacket(hits[49].bytes, 0).kind).toBe('error');
    expect((decodePacket(hits[19].bytes, 0) as { ambiguous: boolean }).ambiguous).toBe(true);
  });

  it('GET_PARAMS → out 기록 + PARAM_ACK 14개와 종료 표시', () => {
    mock.start({ poseHz: 1, hitIntervalMs: 100000 });
    got.length = 0;
    mock.handleCommand(encodeGetParams());
    vi.advanceTimersByTime(1000);
    expect(got[0].dir).toBe('out');
    const acks = got.filter((r) => r.dir === 'in' && r.bytes[0] === 0x06).map((r) => decodePacket(r.bytes, 0) as { paramId: number; value: number });
    expect(acks.length).toBe(15);
    expect(acks.slice(0, 14).map((a) => a.paramId)).toEqual(STICK_PARAMS.map((p) => p.id));
    expect(acks[14]).toMatchObject({ paramId: 0, value: 14 });
  });

  it('SET_PARAM은 범위로 잘라 되돌린다', () => {
    mock.start({ poseHz: 1, hitIntervalMs: 100000 });
    got.length = 0;
    mock.handleCommand(encodeSetParam(0x02, 500));
    vi.advanceTimersByTime(100);
    const a = decodePacket(got[1].bytes, 0);
    expect(a).toMatchObject({ kind: 'paramAck', paramId: 0x02, value: 100 });
  });

  it('SET_PAD_TABLE 3패킷 → 0x20 마지막 값 7', () => {
    mock.start({ poseHz: 1, hitIntervalMs: 100000 });
    got.length = 0;
    const entries = (['SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE', 'CRASH', 'HIHAT'] as const).map((pad) => ({
      pad,
      elevationDeg: 0,
      azimuthDeg: 0,
      radiusDeg: 10,
    }));
    for (const p of encodeSetPadTable(entries, true)) mock.handleCommand(p);
    vi.advanceTimersByTime(100);
    const acks = got
      .filter((r) => r.dir === 'in')
      .map((r) => decodePacket(r.bytes, 0) as { paramId: number; value: number });
    expect(acks.map((a) => a.paramId)).toEqual([0x20, 0x20, 0x20]);
    expect(acks.map((a) => a.value)).toEqual([3, 6, 7]);
  });

  it('SYNC → SYNC_ACK(t0 그대로), SET_MODE는 무응답', () => {
    mock.start({ poseHz: 1, hitIntervalMs: 100000 });
    got.length = 0;
    mock.handleCommand(encodeSync(777));
    mock.handleCommand(new Uint8Array([0x11, 1]));
    vi.advanceTimersByTime(100);
    const ins = got.filter((r) => r.dir === 'in');
    expect(ins.length).toBe(1);
    expect(decodePacket(ins[0].bytes, 0)).toMatchObject({ kind: 'syncAck', t0Ms: 777 });
    expect(got.filter((r) => r.dir === 'out').length).toBe(2);
  });

  it('stop 후에는 발행하지 않는다', () => {
    mock.start();
    vi.advanceTimersByTime(500);
    mock.stop();
    expect(mock.running).toBe(false);
    const n = got.length;
    vi.advanceTimersByTime(5000);
    mock.handleCommand(encodeGetParams());
    expect(got.length).toBe(n);
  });

  it('스틱 2개면 role 0·1 모두 POSE를 낸다', () => {
    mock.start({ sticks: 2, hitIntervalMs: 100000 });
    vi.advanceTimersByTime(100);
    const roles = new Set(got.filter((r) => r.bytes[0] === 0x02).map((r) => r.bytes[1] & 3));
    expect(roles).toEqual(new Set([0, 1]));
  });
});
