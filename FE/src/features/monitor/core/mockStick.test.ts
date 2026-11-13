import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSetMode, StreamMode, encodeGetParams, encodeSetParam, encodeSetPadTable, decodePacket, encodeSync, encodeRoute, encodeSetYawOffset, encodeResetPose, STICK_PARAMS, PAD_CODE } from '@/input/stickProtocol';
import { packetTap, type PacketRecord } from '@/input/packetTap';
import {
  buildBridgeStats,
  buildHit,
  buildLink,
  buildLog,
  buildParamAck,
  buildPose,
  buildStatus,
  buildSwing,
  buildSyncAck,
  MockStick,
  mockVelocity,
} from './mockStick';
import { spearman } from './syncTrend';

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

describe('SWING 빌더', () => {
  it('왕복', () => {
    const samples = Int16Array.from({ length: 120 }, (_, i) => (i - 60) * 100);
    expect(decodePacket(buildSwing({ role: 1, hitSeq: 9, chunkIdx: 3, chunkCount: 10, samples }), 0)).toMatchObject({
      kind: 'swing',
      role: 1,
      hitSeq: 9,
      chunkIdx: 3,
      chunkCount: 10,
      samples,
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
    expect(decodePacket(got[0].bytes, 0)).toMatchObject({ kind: 'log', text: 'BOOT 1.0 nrf52' });
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

  it('HIT velocity가 peakSpeed를 따라 오른다(스피어만 0.8 이상, 0~127)', () => {
    mock.start({ hitIntervalMs: 100, poseHz: 1 });
    vi.advanceTimersByTime(100 * 120);
    const hits = got
      .filter((r) => r.dir === 'in' && r.bytes[0] === 0x01)
      .map((r) => decodePacket(r.bytes, 0))
      .filter((d) => d.kind === 'hit') as { peakSpeedDps: number; velocity: number }[];
    expect(hits.length).toBeGreaterThan(100);
    expect(hits.every((h) => h.velocity >= 0 && h.velocity <= 127)).toBe(true);
    const rho = spearman(hits.map((h) => h.peakSpeedDps), hits.map((h) => h.velocity));
    expect(rho).not.toBeNull();
    expect(rho as number).toBeGreaterThanOrEqual(0.8);
  });

  it('mockVelocity는 경계에서 0~127로 자른다', () => {
    for (let i = 0; i < 50; i++) {
      expect(mockVelocity(0)).toBe(0);
      expect(mockVelocity(5000)).toBe(127);
    }
  });

  it('GET_PARAMS의 0x21은 SET_YAW_OFFSET으로 보낸 값이고 RESET_POSE 뒤에는 0이다', () => {
    mock.start({ poseHz: 1, hitIntervalMs: 100000 });
    const yawOf = () => {
      got.length = 0;
      mock.handleCommand(encodeGetParams());
      vi.advanceTimersByTime(1000);
      const acks = got.filter((r) => r.dir === 'in' && r.bytes[0] === 0x06).map((r) => decodePacket(r.bytes, 0) as { paramId: number; value: number });
      return acks.find((x) => x.paramId === 0x21)?.value;
    };
    mock.handleCommand(encodeSetYawOffset(-58));
    vi.advanceTimersByTime(100);
    expect(yawOf()).toBe(-5800);
    mock.handleCommand(encodeResetPose());
    vi.advanceTimersByTime(100);
    expect(yawOf()).toBe(0);
  });

  it('GET_PARAMS → out 기록 + PARAM_ACK 14개, 현재 방위각 오프셋(0x21), 종료 표시', () => {
    mock.start({ poseHz: 1, hitIntervalMs: 100000 });
    got.length = 0;
    mock.handleCommand(encodeGetParams());
    vi.advanceTimersByTime(1000);
    expect(got[0].dir).toBe('out');
    const acks = got.filter((r) => r.dir === 'in' && r.bytes[0] === 0x06).map((r) => decodePacket(r.bytes, 0) as { paramId: number; value: number });
    expect(acks.length).toBe(16);
    expect(acks.slice(0, 14).map((a) => a.paramId)).toEqual(STICK_PARAMS.map((p) => p.id));
    // 스틱 FW 1.12: 끝 표시 앞에 0x21. 끝 표시의 개수는 그대로 14
    expect(acks[14]).toMatchObject({ paramId: 0x21, value: 0 });
    expect(acks[15]).toMatchObject({ paramId: 0, value: 14 });
    // Feather fw 1.0 기본값
    const byId = Object.fromEntries(acks.slice(0, 14).map((a) => [a.paramId, a.value]));
    expect(byId).toMatchObject({ 0x0a: 60, 0x0b: 160, 0x0e: 800, 0x0f: 1200, 0x01: 150 });
  });

  it('Feather 모사: STATUS fwMajor 1·minor 0·battery 없음, 부팅 BIAS 줄, drop short 섞임', () => {
    mock.start({ poseHz: 1, hitIntervalMs: 100 });
    vi.advanceTimersByTime(100 * 12);
    const dec = got.filter((r) => r.dir === 'in').map((r) => decodePacket(r.bytes, 0));
    expect(dec.find((d) => d.kind === 'status')).toMatchObject({ fwMajor: 1, fwMinor: 0, batteryPct: null });
    expect(dec.find((d) => d.kind === 'log' && d.text.startsWith('BIAS'))).toMatchObject({ text: 'BIAS 3 -2 4' });
    const logs = dec.flatMap((d) => (d.kind === 'log' ? [d.text] : []));
    expect(logs).toContain('drop short 90');
    expect(logs).toContain('drop weak 320');
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

  it('스틱 2개면 SYNC에 role 0·1이 같은 t0Ms로 SYNC_ACK를 각각 보낸다', () => {
    mock.start({ sticks: 2, poseHz: 1, hitIntervalMs: 100000 });
    got.length = 0;
    mock.handleCommand(encodeSync(777));
    vi.advanceTimersByTime(100);
    const acks = got
      .filter((r) => r.dir === 'in' && r.bytes[0] === 0x04)
      .map((r) => decodePacket(r.bytes, 0) as { kind: string; role: number; t0Ms: number });
    expect(acks.map((a) => a.role)).toEqual([0, 1]);
    expect(acks.map((a) => a.t0Ms)).toEqual([777, 777]);
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

  describe('SWING', () => {
    const swings = () => got.filter((r) => r.bytes[0] === 0x05);

    it('RAW_COLLECT 전에는 SWING이 없다', () => {
      mock.start({ hitIntervalMs: 100, poseHz: 1 });
      vi.advanceTimersByTime(1000);
      expect(count('hit')).toBeGreaterThan(5);
      expect(swings().length).toBe(0);
    });

    it('SET_MODE 2 뒤 HIT 1건 → SWING 169청크(샘플 1개씩), hitSeq 일치', () => {
      mock.start({ hitIntervalMs: 1000, poseHz: 1 });
      mock.handleCommand(encodeSetMode(StreamMode.RAW_COLLECT));
      vi.advanceTimersByTime(1000 + 800);
      const hit = got.map((r) => decodePacket(r.bytes, 0)).find((d) => d.kind === 'hit');
      const sw = swings().map((r) => decodePacket(r.bytes, 0));
      expect(sw.length).toBe(169);
      expect(sw.map((d) => (d.kind === 'swing' ? d.chunkIdx : -1))).toEqual(Array.from({ length: 169 }, (_, i) => i));
      for (const d of sw) {
        expect(d).toMatchObject({ kind: 'swing', chunkCount: 169 });
        if (d.kind === 'swing') {
          expect(d.samples.length).toBe(6);
          expect(d.hitSeq).toBe(hit !== undefined && hit.kind === 'hit' ? hit.seq : -1);
        }
      }
    });

    it('SET_MODE로 되돌리면 다시 SWING이 없다', () => {
      mock.start({ hitIntervalMs: 1000, poseHz: 1 });
      mock.handleCommand(encodeSetMode(StreamMode.RAW_COLLECT));
      mock.handleCommand(encodeSetMode(StreamMode.HIT_AND_POSE));
      vi.advanceTimersByTime(1500);
      expect(swings().length).toBe(0);
    });

    it('30번째 HIT의 SWING은 청크 80~84가 빠진 164청크', () => {
      mock.start({ hitIntervalMs: 1000, poseHz: 1 });
      mock.handleCommand(encodeSetMode(StreamMode.RAW_COLLECT));
      vi.advanceTimersByTime(30 * 1000 + 800);
      const sw = swings();
      expect(sw.length).toBe(29 * 169 + 164);
      const last = sw.slice(-164).map((r) => decodePacket(r.bytes, 0));
      const idx = last.map((d) => (d.kind === 'swing' ? d.chunkIdx : -1));
      const all = new Set(idx);
      const missing = Array.from({ length: 169 }, (_, i) => i).filter((i) => !all.has(i));
      expect(missing).toEqual([80, 81, 82, 83, 84]);
    });

    it('stop이 SWING 타이머도 정리한다', () => {
      mock.start({ hitIntervalMs: 1000, poseHz: 1 });
      mock.handleCommand(encodeSetMode(StreamMode.RAW_COLLECT));
      vi.advanceTimersByTime(1050);
      expect(swings().length).toBeLessThan(169);
      mock.stop();
      const n = swings().length;
      vi.advanceTimersByTime(1000);
      expect(swings().length).toBe(n);
    });
  });
});

describe('v0.8 빌더', () => {
  it('LINK 왕복: 5바이트, flags 0, 기본 fw 2.1', () => {
    const b = buildLink({ linkMask: 0b0101 });
    expect(b.length).toBe(5);
    expect(decodePacket(b, 3)).toEqual({ kind: 'link', recvTime: 3, flags: 0, linkMask: 0b0101, fwMajor: 2, fwMinor: 1 });
    expect(decodePacket(buildLink({ linkMask: 3, fwMajor: 3, fwMinor: 9 }), 0)).toMatchObject({ linkMask: 3, fwMajor: 3, fwMinor: 9 });
  });

  it('STATUS unconfigured는 flags 비트 5, role은 그대로(role 3 포함)', () => {
    const f = { batteryPct: 50, rssi: -60, fwMajor: 1, fwMinor: 0 };
    const b = buildStatus({ ...f, role: 1, unconfigured: true });
    expect(b[1]).toBe(0x21);
    expect(decodePacket(b, 0)).toMatchObject({ role: 1, unconfigured: true });
    expect(buildStatus({ ...f, role: 3, unconfigured: true })[1]).toBe(0x23);
    expect(decodePacket(buildStatus({ ...f, role: 1 }), 0)).toMatchObject({ role: 1, unconfigured: false });
  });
});

describe('MockStick 재연결 시나리오', () => {
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

  const ins = () => got.filter((r) => r.dir === 'in').map((r) => decodePacket(r.bytes, 0));
  const links = () => ins().filter((d) => d.kind === 'link') as { linkMask: number }[];
  const ofRole = (role: number) => ins().filter((d) => 'role' in d && d.role === role);
  const start2 = (dongle = true) => mock.start({ sticks: 2, dongle, poseHz: 50, hitIntervalMs: 100000 });
  const padTable = encodeSetPadTable([{ pad: 'SNARE', elevationDeg: 0, azimuthDeg: 0, radiusDeg: 10 }], true, 2)[0];

  describe('dongle 옵션', () => {
    it('start 시 STATUS 다음 LINK, 이후 1초마다 LINK(마스크 = 붙은 손)', () => {
      start2();
      const first = ins().filter((d) => d.kind === 'status' || d.kind === 'link');
      expect(first.map((d) => d.kind)).toEqual(['status', 'status', 'link']);
      expect(links()[0].linkMask).toBe(0b11);
      vi.advanceTimersByTime(3000);
      expect(links().length).toBe(4);
    });

    it('스틱 1개면 마스크 0b01', () => {
      mock.start({ sticks: 1, dongle: true });
      expect(links()[0].linkMask).toBe(0b01);
    });

    it('dongle을 안 주면 LINK가 없다', () => {
      start2(false);
      vi.advanceTimersByTime(3000);
      expect(links().length).toBe(0);
    });
  });

  describe('dropHand', () => {
    it('즉시 LINK 1회(마스크에서 그 손 빠짐), 이후 그 손의 STATUS·POSE·HIT·SYNC_ACK가 없다', () => {
      mock.start({ sticks: 2, dongle: true, poseHz: 50, hitIntervalMs: 100 });
      got.length = 0;
      mock.dropHand(1);
      expect(links().map((l) => l.linkMask)).toEqual([0b01]);
      vi.advanceTimersByTime(6000);
      expect(ofRole(1)).toEqual([]);
      expect(ofRole(0).some((d) => d.kind === 'pose')).toBe(true);
      expect(ofRole(0).some((d) => d.kind === 'hit')).toBe(true);
      expect(links().every((l) => l.linkMask === 0b01)).toBe(true);
      got.length = 0;
      mock.handleCommand(encodeSync(1234));
      vi.advanceTimersByTime(100);
      const acks = ins().filter((d) => d.kind === 'syncAck') as { role: number }[];
      expect(acks.map((a) => a.role)).toEqual([0]);
    });

    it('dongle이 아니면 LINK 없이 조용히 끊긴다', () => {
      start2(false);
      got.length = 0;
      mock.dropHand(1);
      expect(links().length).toBe(0);
    });
  });

  describe('restoreHand', () => {
    it('STATUS 1회가 먼저, 그다음 LINK(마스크에 그 손 복귀)', () => {
      start2();
      mock.dropHand(1);
      got.length = 0;
      mock.restoreHand(1);
      const seq = ins();
      expect(seq.map((d) => d.kind)).toEqual(['status', 'link']);
      expect(seq[0]).toMatchObject({ role: 1, unconfigured: false });
      expect(seq[1]).toMatchObject({ linkMask: 0b11 });
    });

    it('reboot: 비트 5가 SET_PAD_TABLE을 받을 때까지 유지되고 받으면 내려간다', () => {
      start2();
      mock.dropHand(1);
      got.length = 0;
      mock.restoreHand(1, { reboot: true });
      expect(ins()[0]).toMatchObject({ kind: 'status', role: 1, unconfigured: true });
      // 5초 주기 STATUS에도 유지
      vi.advanceTimersByTime(5000);
      const st = () => ofRole(1).filter((d) => d.kind === 'status') as { unconfigured: boolean }[];
      expect(st().every((d) => d.unconfigured)).toBe(true);
      // 다른 손에만 보낸 SET_PAD_TABLE은 영향 없음
      mock.handleCommand(encodeRoute(0, padTable));
      vi.advanceTimersByTime(5000);
      expect(st().every((d) => d.unconfigured)).toBe(true);
      // 그 손에 ROUTE로 감싼 SET_PAD_TABLE → 내려간다
      mock.handleCommand(encodeRoute(1, padTable));
      vi.advanceTimersByTime(5000);
      const all = st();
      expect(all[all.length - 1].unconfigured).toBe(false);
      expect(all.length).toBeGreaterThan(2);
    });

    it('reboot가 아니면 비트 5는 그대로 0', () => {
      start2();
      mock.dropHand(0);
      mock.restoreHand(0);
      vi.advanceTimersByTime(5000);
      expect((ofRole(0).filter((d) => d.kind === 'status') as { unconfigured: boolean }[]).every((d) => !d.unconfigured)).toBe(true);
    });
  });

  describe('reboot', () => {
    it('dropHand 다음 restoreHand(reboot): LINK(빠짐) → STATUS(비트 5) → LINK(복귀) 순서', () => {
      start2();
      got.length = 0;
      mock.reboot(1);
      const seq = ins();
      expect(seq.map((d) => d.kind)).toEqual(['link', 'status', 'link']);
      expect(seq[0]).toMatchObject({ linkMask: 0b01 });
      expect(seq[1]).toMatchObject({ role: 1, unconfigured: true });
      expect(seq[2]).toMatchObject({ linkMask: 0b11 });
    });

    it('그 손의 모의 시계만 0부터 다시 시작한다(다른 손은 유지)', () => {
      start2();
      vi.advanceTimersByTime(10_000); // 5초 뒤 u32 µs 랩이 이미 일어난 시각
      mock.reboot(1);
      got.length = 0;
      vi.advanceTimersByTime(100);
      const ts = (role: number) => (ofRole(role).find((d) => d.kind === 'pose') as { timestampUs: number }).timestampUs;
      // 재부팅한 손: 실제 스틱처럼 0부터, 약 0.02~0.1초 뒤
      expect(ts(1)).toBeGreaterThan(0);
      expect(ts(1)).toBeLessThan(200_000);
      // 그대로 가동 중인 손: 랩 뒤 약 5초
      expect(ts(0)).toBeGreaterThan(4_000_000);
      expect(ts(0)).toBeLessThan(6_000_000);
    });

    it('시계 0부터: SYNC_ACK의 t1도 손별로 다르다', () => {
      start2();
      vi.advanceTimersByTime(10_000);
      mock.reboot(1);
      got.length = 0;
      mock.handleCommand(encodeSync(1));
      vi.advanceTimersByTime(100);
      const acks = ins().filter((d) => d.kind === 'syncAck') as { role: number; t1Us: number }[];
      const t1 = (role: number) => acks.find((a) => a.role === role)!.t1Us;
      expect(t1(1)).toBeLessThan(200_000);
      expect(t1(0)).toBeGreaterThan(4_000_000);
      expect(t1(0)).toBeLessThan(6_000_000);
    });
  });

  describe('ROUTE 풀기', () => {
    const acks = (id: number) => ins().filter((d) => d.kind === 'paramAck' && d.paramId === id) as { role: number; value: number }[];

    it('ROUTE로 감싼 SET_YAW_OFFSET은 대상 손만 응답하고 role이 대상 손이다', () => {
      start2();
      got.length = 0;
      mock.handleCommand(encodeRoute(1, encodeSetYawOffset(1.5)));
      vi.advanceTimersByTime(100);
      expect(acks(0x21)).toMatchObject([{ role: 1, value: 150 }]);
      // 바깥 ROUTE 바이트 그대로 out 기록
      expect(got[0].dir).toBe('out');
      expect(got[0].bytes[0]).toBe(0x70);
    });

    it('감싸지 않은 명령은 붙은 손 전부에 적용한다', () => {
      start2();
      got.length = 0;
      mock.handleCommand(encodeSetYawOffset(0));
      vi.advanceTimersByTime(100);
      expect(acks(0x21).map((a) => a.role)).toEqual([0, 1]);
    });

    it('ROUTE SET_PAD_TABLE: 손별로 패드 개수를 센다', () => {
      start2();
      got.length = 0;
      mock.handleCommand(encodeRoute(1, padTable));
      mock.handleCommand(encodeRoute(0, padTable));
      mock.handleCommand(encodeRoute(1, encodeSetPadTable([{ pad: 'HIHAT', elevationDeg: 0, azimuthDeg: 0, radiusDeg: 10 }], false, 2)[0]));
      vi.advanceTimersByTime(100);
      expect(acks(0x20)).toMatchObject([
        { role: 1, value: 1 },
        { role: 0, value: 1 },
        { role: 1, value: 2 },
      ]);
    });

    it('마스크가 양손이면 둘 다, 끊긴 손은 받지 못한다', () => {
      start2();
      got.length = 0;
      const both = new Uint8Array([0x70, 0b11, ...encodeSetYawOffset(0)]);
      mock.handleCommand(both);
      vi.advanceTimersByTime(100);
      expect(acks(0x21).map((a) => a.role)).toEqual([0, 1]);
      mock.dropHand(1);
      got.length = 0;
      mock.handleCommand(both);
      vi.advanceTimersByTime(100);
      expect(acks(0x21).map((a) => a.role)).toEqual([0]);
    });

    it('ROUTE로 감싼 SYNC는 대상 손만 ACK', () => {
      start2();
      got.length = 0;
      mock.handleCommand(encodeRoute(1, encodeSync(5)));
      vi.advanceTimersByTime(100);
      expect((ins().filter((d) => d.kind === 'syncAck') as { role: number }[]).map((a) => a.role)).toEqual([1]);
    });
  });
});

describe('MockStick 타격 각도(PLAY-004)', () => {
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

  const hitsOf = () =>
    got
      .filter((r) => r.dir === 'in' && r.bytes[0] === 0x01 && r.bytes.length === 20)
      .map((r) => decodePacket(r.bytes, 0))
      .filter((d): d is Extract<typeof d, { kind: 'hit' }> => d.kind === 'hit');

  it('표를 받기 전(패드 0개)에는 pad 0xFF(null), 각도는 그 손의 기본 앵커 ±1.5° 안', async () => {
    const { defaultHandAnchors } = await import('@/domain/kit/kitModel');
    const { resolvePad } = await import('@/domain/kit/calibration/calibration');
    const { anchorsToProfile } = await import('@/domain/kit/kitJudge');
    const { DEFAULT_SENSOR_TUNING } = await import('@/domain/kit/calibration/tuning');
    mock.start({ sticks: 2, hitIntervalMs: 100, poseHz: 1 });
    vi.advanceTimersByTime(100 * 30);
    const hits = hitsOf();
    expect(hits.length).toBeGreaterThan(20);
    expect(hits.every((h) => h.pad === null)).toBe(true);
    const anchors = defaultHandAnchors();
    for (const h of hits) {
      const role = h.role === 1 ? 1 : 0;
      const profile = anchorsToProfile(anchors[role], DEFAULT_SENSOR_TUNING, role);
      const r = resolvePad(profile, { pitch: h.elevationDeg, yaw: h.azimuthDeg });
      // FE 기본 표로 판정하면 반경 안의 어느 패드에 들어간다
      expect(r?.inside).toBe(true);
    }
  });

  it('표를 받은 손은 pad를 채워 보낸다', () => {
    mock.start({ sticks: 1, hitIntervalMs: 100, poseHz: 1 });
    mock.handleCommand(encodeSetPadTable([{ pad: 'SNARE', elevationDeg: 0, azimuthDeg: 0, radiusDeg: 10 }], true, 2)[0]);
    got.length = 0;
    vi.advanceTimersByTime(100 * 10);
    const hits = hitsOf();
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.every((h) => h.pad !== null)).toBe(true);
  });
});
