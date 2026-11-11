import { describe, expect, it } from 'vitest';
import {
  PARAM_ACK_PAD_TABLE,
  PARAM_ACK_END,
  PAD_CODE,
  STICK_PARAMS,
  encodeGetParams,
  encodeSetParam,
  encodeSetPadTable,
  decodeSetPadTable,
  encodeSetYawOffset,
  stickParamById,
  stickParamDefault,
  firmwareOfMajor,
  PAD_NONE,
  decodePacket,
  encodeHaptic,
  encodeHapticWave,
  encodeResetPose,
  encodeSetMode,
  encodeSync,
  encodeRoute,
  padFromCode,
  parsePacket,
  FLAG_UNCONFIGURED,
  footOf,
  handOf,
} from './stickProtocol';
import { buildHit, buildPedal, buildPose, buildStatus } from '@/features/monitor/core/mockStick';

/** HIT 20바이트 만들기 */
function hitBytes(o: { flags?: number; pad?: number } = {}): Uint8Array {
  const b = new Uint8Array(20);
  const v = new DataView(b.buffer);
  b[0] = 0x01;
  b[1] = o.flags ?? 0;
  b[2] = 7; // seq
  v.setUint32(3, 1_234_567, true);
  b[7] = o.pad ?? 2;
  b[8] = 35; // margin 3.5
  v.setInt16(9, -1250, true); // elevation -12.5
  v.setInt16(11, 3075, true); // azimuth 30.75
  v.setUint16(13, 4321, true);
  b[15] = 100; // velocity
  b[16] = 42; // swingMs
  v.setInt16(17, -25, true); // lateral -2.5
  b[19] = 18; // decel 1.8
  return b;
}

describe('decodePacket HIT', () => {
  it('20B 전 필드를 단위 변환한다', () => {
    const d = decodePacket(hitBytes(), 99);
    expect(d).toMatchObject({
      kind: 'hit',
      recvTime: 99,
      seq: 7,
      timestampUs: 1_234_567,
      pad: 'SNARE',
      marginDeg: 3.5,
      elevationDeg: -12.5,
      azimuthDeg: 30.75,
      peakSpeedDps: 4321,
      velocity: 100,
      swingMs: 42,
      lateralDeg: -2.5,
      decel: 1.8,
      role: 0,
      magAnomaly: false,
      ambiguous: false,
    });
  });

  it('pad 0xFF는 null, 3은 SMALL_TOM, 8은 HIHAT_PEDAL', () => {
    expect(decodePacket(hitBytes({ pad: PAD_NONE }), 0)).toMatchObject({ pad: null });
    expect(decodePacket(hitBytes({ pad: 3 }), 0)).toMatchObject({ pad: 'SMALL_TOM' });
    expect(decodePacket(hitBytes({ pad: 8 }), 0)).toMatchObject({ pad: 'HIHAT_PEDAL' });
  });

  it('flags 비트: role·magAnomaly·ambiguous', () => {
    expect(decodePacket(hitBytes({ flags: 0b00001 }), 0)).toMatchObject({ role: 1, magAnomaly: false, ambiguous: false });
    expect(decodePacket(hitBytes({ flags: 0b01000 }), 0)).toMatchObject({ role: 0, magAnomaly: true, ambiguous: false });
    expect(decodePacket(hitBytes({ flags: 0b10001 }), 0)).toMatchObject({ role: 1, magAnomaly: false, ambiguous: true });
  });

  it('19B는 error short', () => {
    expect(decodePacket(hitBytes().subarray(0, 19), 0)).toMatchObject({ kind: 'error', reason: 'short', type: 1 });
  });
});

describe('decodePacket 그 외', () => {
  function pose(len: number): Uint8Array {
    const b = new Uint8Array(len);
    const v = new DataView(b.buffer);
    b[0] = 0x02;
    v.setUint32(2, 5000, true);
    v.setInt16(6, 1000, true);
    v.setInt16(8, -2000, true);
    v.setInt16(10, 50, true);
    if (len > 12) b[12] = 9;
    return b;
  }

  it('POSE 12B는 seq null', () => {
    expect(decodePacket(pose(12), 0)).toMatchObject({
      kind: 'pose',
      timestampUs: 5000,
      elevationDeg: 10,
      azimuthDeg: -20,
      rollDeg: 0.5,
      seq: null,
    });
  });

  it('POSE 13B는 seq 있음', () => {
    expect(decodePacket(pose(13), 0)).toMatchObject({ kind: 'pose', seq: 9 });
  });

  it('STATUS: battery 0xFF는 null, rssi는 음수', () => {
    const d = decodePacket(new Uint8Array([0x03, 1, 0xff, 0xc4, 1, 2]), 0);
    expect(d).toMatchObject({ kind: 'status', batteryPct: null, rssi: -60, fwMajor: 1, fwMinor: 2, role: 1 });
    expect(decodePacket(new Uint8Array([0x03, 0, 80, 0, 1, 2]), 0)).toMatchObject({ batteryPct: 80 });
  });

  it('SYNC_ACK', () => {
    const b = new Uint8Array(10);
    const v = new DataView(b.buffer);
    b[0] = 0x04;
    v.setUint32(2, 123456, true);
    v.setUint32(6, 7_000_000, true);
    expect(decodePacket(b, 0)).toMatchObject({ kind: 'syncAck', t0Ms: 123456, t1Us: 7_000_000 });
  });

  it('LINK 5B: 연결 마스크·동글 fw, 4B는 error short', () => {
    expect(decodePacket(new Uint8Array([0x07, 0, 0b0011, 2, 1]), 7)).toEqual({
      kind: 'link',
      recvTime: 7,
      flags: 0,
      linkMask: 0b0011,
      fwMajor: 2,
      fwMinor: 1,
    });
    expect(decodePacket(new Uint8Array([0x07, 0, 1, 2]), 0)).toMatchObject({ kind: 'error', reason: 'short', type: 7 });
  });

  it('BRIDGE_STATS 14B', () => {
    const b = new Uint8Array(14);
    const v = new DataView(b.buffer);
    b[0] = 0x7e;
    v.setUint32(2, 1000, true);
    v.setUint32(6, 3, true);
    v.setUint32(10, 2, true);
    expect(decodePacket(b, 5)).toEqual({ kind: 'bridgeStats', recvTime: 5, okFrames: 1000, crcErrors: 3, resyncCount: 2 });
  });

  it('LOG 문자열', () => {
    const text = 'boot ok';
    const b = new Uint8Array([0x7f, 0, ...[...text].map((c) => c.charCodeAt(0)), 0, 0]);
    expect(decodePacket(b, 0)).toMatchObject({ kind: 'log', text });
  });

  it('PARAM_ACK: 음수 value, 예약 id 0x00·0x20', () => {
    expect(decodePacket(new Uint8Array([0x06, 1, 0x03, 0x9c, 0xff]), 4)).toMatchObject({
      kind: 'paramAck',
      recvTime: 4,
      role: 1,
      paramId: 3,
      value: -100,
    });
    expect(decodePacket(new Uint8Array([0x06, 0, PARAM_ACK_END, 14, 0]), 0)).toMatchObject({ paramId: 0, value: 14 });
    expect(decodePacket(new Uint8Array([0x06, 0, PARAM_ACK_PAD_TABLE, 7, 0]), 0)).toMatchObject({ paramId: 0x20, value: 7 });
  });

  it('PARAM_ACK 4B는 error short', () => {
    expect(decodePacket(new Uint8Array([0x06, 0, 1, 2]), 0)).toMatchObject({ kind: 'error', reason: 'short', type: 6 });
  });

  it('SWING: 샘플 2개, 불완전 바이트는 잘린다', () => {
    const b = new Uint8Array(5 + 24 + 5);
    const v = new DataView(b.buffer);
    b[0] = 0x05;
    b[2] = 9;
    b[3] = 1;
    b[4] = 3;
    for (let i = 0; i < 12; i++) v.setInt16(5 + i * 2, i - 6, true);
    const d = decodePacket(b, 0);
    expect(d).toMatchObject({ kind: 'swing', hitSeq: 9, chunkIdx: 1, chunkCount: 3 });
    if (d.kind !== 'swing') throw new Error('swing 아님');
    expect([...d.samples]).toEqual([-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    expect(decodePacket(b.subarray(0, 5), 0)).toMatchObject({ kind: 'swing' });
    expect(decodePacket(b.subarray(0, 4), 0)).toMatchObject({ kind: 'error', reason: 'short' });
  });

  it('모르는 타입은 error badType, 1B는 error short', () => {
    expect(decodePacket(new Uint8Array([0x99, 0, 0]), 0)).toMatchObject({ kind: 'error', reason: 'badType', type: 0x99 });
    expect(decodePacket(new Uint8Array([0x01]), 0)).toMatchObject({ kind: 'error', reason: 'short' });
    expect(decodePacket(new Uint8Array([]), 0)).toMatchObject({ kind: 'error', reason: 'short', type: null });
  });
});

describe('padFromCode', () => {
  it('경계', () => {
    expect(padFromCode(0)).toBe('CRASH');
    expect(padFromCode(6)).toBe('RIDE');
    expect(padFromCode(7)).toBe('KICK');
    expect(padFromCode(8)).toBe('HIHAT_PEDAL');
    expect(padFromCode(9)).toBeNull();
    expect(padFromCode(0xff)).toBeNull();
  });

  it('PAD_CODE와 왕복한다', () => {
    for (const [pad, code] of Object.entries(PAD_CODE)) expect(padFromCode(code)).toBe(pad);
  });
});

describe('parsePacket', () => {
  it('hit: ms 시각·peakAccel·pad·velocity·stickId', () => {
    const p = parsePacket(hitBytes({ flags: 1, pad: 4 }), 77);
    expect(p).toEqual({
      kind: 'hit',
      stickId: 1,
      timestamp: 1234.567,
      recvTime: 77,
      peakAccel: 43.21,
      pitch: -12.5,
      yaw: 30.75,
      pad: 'MID_TOM',
      velocity: 100,
      marginDeg: 3.5,
      ambiguous: false,
      peakSpeedDps: 4321,
      seq: 7,
    });
  });

  it('hit pad 0xFF는 null로 실린다', () => {
    expect(parsePacket(hitBytes({ pad: 0xff }), 0)).toMatchObject({ pad: null });
  });

  it('pose·status 좁히기', () => {
    const b = new Uint8Array(12);
    new DataView(b.buffer).setUint32(2, 2500, true);
    b[0] = 0x02;
    expect(parsePacket(b, 0)).toMatchObject({ kind: 'pose', stickId: 0, timestamp: 2.5 });
    expect(parsePacket(new Uint8Array([0x03, 1, 0xff, 5, 1, 2]), 0)).toEqual({
      kind: 'status',
      stickId: 1,
      connected: true,
      batteryPct: undefined,
      rssi: 5,
      firmware: '1.2',
      unconfigured: false,
    });
  });

  it('syncAck t1은 ms', () => {
    const b = new Uint8Array(10);
    const v = new DataView(b.buffer);
    b[0] = 0x04;
    v.setUint32(2, 100, true);
    v.setUint32(6, 2_500_000, true);
    expect(parsePacket(b, 0)).toEqual({ kind: 'syncAck', stickId: 0, t0: 100, t1: 2500 });
  });

  it('syncAck stickId는 flags role에서 온다(동글 아래 두 스틱이 각자 답함)', () => {
    const b = new Uint8Array(10);
    b[0] = 0x04;
    b[1] = 1;
    expect(parsePacket(b, 0)).toMatchObject({ kind: 'syncAck', stickId: 1 });
  });

  it('발 역할(role 2·3) 패킷은 손 이벤트가 아니라 foot·pedalStatus로 읽는다', () => {
    expect(parsePacket(hitBytes({ flags: 2 }), 0)).toMatchObject({ kind: 'hit', stickId: null, foot: 2 });
    expect(parsePacket(hitBytes({ flags: 3 }), 0)).toMatchObject({ kind: 'hit', stickId: null, foot: 3 });
    expect(parsePacket(new Uint8Array([0x03, 2, 80, 0, 1, 2]), 0)).toEqual({
      kind: 'pedalStatus',
      foot: 2,
      connected: true,
      batteryPct: 80,
    });
    const ack = new Uint8Array(10);
    ack[0] = 0x04;
    ack[1] = 3;
    expect(parsePacket(ack, 0)).toBeNull();
    // role 외 비트가 켜져 있어도 손이면 그대로
    expect(parsePacket(hitBytes({ flags: 0x10 | 1 }), 0)).toMatchObject({ kind: 'hit', stickId: 1 });
  });

  it('link는 이벤트가 아니라 null', () => {
    expect(parsePacket(new Uint8Array([0x07, 0, 3, 2, 0]), 0)).toBeNull();
  });

  it('bridgeStats·log·paramAck·swing·error는 null', () => {
    const stats = new Uint8Array(14);
    stats[0] = 0x7e;
    expect(parsePacket(stats, 0)).toBeNull();
    expect(parsePacket(new Uint8Array([0x7f, 0, 65]), 0)).toBeNull();
    expect(parsePacket(new Uint8Array([0x06, 0, 1, 2, 0]), 0)).toBeNull();
    expect(parsePacket(new Uint8Array([0x05, 0, 1, 0, 1]), 0)).toBeNull();
    expect(parsePacket(new Uint8Array([0x99, 0, 1]), 0)).toBeNull();
  });

  it('DataView 입력(오프셋 포함)도 동작한다', () => {
    const hit = hitBytes({ pad: 1 });
    const buf = new Uint8Array(23);
    buf.set(hit, 3);
    const p = parsePacket(new DataView(buf.buffer, 3, 20), 0);
    expect(p).toMatchObject({ kind: 'hit', pad: 'HIHAT' });
  });
});

describe('인코더', () => {
  it('SYNC', () => {
    expect([...encodeSync(0x01020304 + 0.7)]).toEqual([0x10, 0x04, 0x03, 0x02, 0x01]);
  });
  it('SET_MODE', () => {
    expect([...encodeSetMode(1)]).toEqual([0x11, 1]);
  });
  it('HAPTIC', () => {
    expect([...encodeHaptic(200, 150)]).toEqual([0x12, 200, 15]);
    expect([...encodeHaptic(999, -5)]).toEqual([0x12, 255, 0]);
  });
  it('RESET_POSE', () => {
    expect([...encodeResetPose()]).toEqual([0x13]);
  });
  it('SET_PARAM: i16 LE, 반올림·clamp', () => {
    expect([...encodeSetParam(0x03, 400)]).toEqual([0x14, 0x03, 0x90, 0x01]);
    expect([...encodeSetParam(0x03, -2.6)]).toEqual([0x14, 0x03, 0xfd, 0xff]);
    expect([...encodeSetParam(1, 99999)]).toEqual([0x14, 1, 0xff, 0x7f]);
    expect([...encodeSetParam(1, -99999)]).toEqual([0x14, 1, 0x00, 0x80]);
  });
  it('SET_YAW_OFFSET 음수', () => {
    expect([...encodeSetYawOffset(-1.5)]).toEqual([0x16, 0x6a, 0xff]);
    expect([...encodeSetYawOffset(2)]).toEqual([0x16, 0xc8, 0x00]);
  });
  it('GET_PARAMS', () => {
    expect([...encodeGetParams()]).toEqual([0x17]);
  });
  it('ROUTE: [0x70][1 << 손][원래 명령]', () => {
    expect([...encodeRoute(0, encodeSetYawOffset(2))]).toEqual([0x70, 0b01, 0x16, 0xc8, 0x00]);
    expect([...encodeRoute(1, encodeHaptic(200, 30))]).toEqual([0x70, 0b10, ...encodeHaptic(200, 30)]);
  });
});

describe('encodeSetPadTable', () => {
  const e = (pad: keyof typeof PAD_CODE, el = 0, az = 0, r = 10) => ({ pad, elevationDeg: el, azimuthDeg: az, radiusDeg: r });

  it('7개 → 3·3·1, ctrl 0x83·0x03·0x01', () => {
    const pads = ['CRASH', 'HIHAT', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE'] as const;
    const p = encodeSetPadTable(
      pads.map((x) => e(x)),
      true,
    );
    expect(p.map((x) => x[1])).toEqual([0x83, 0x03, 0x01]);
    expect(p.map((x) => x.length)).toEqual([20, 20, 8]);
    expect(p.every((x) => x[0] === 0x15)).toBe(true);
    expect(p[1][2]).toBe(PAD_CODE.SMALL_TOM);
  });

  it('clearFirst=false면 첫 패킷도 비트 7 없음', () => {
    expect(encodeSetPadTable([e('SNARE')], false)[0][1]).toBe(0x01);
  });

  it('항목 바이트: 음수 각도 i16, radius 0.5° 단위', () => {
    const [p] = encodeSetPadTable([e('SNARE', -12.5, 30.75, 7.5)], true);
    expect([...p]).toEqual([0x15, 0x81, 2, 0x1e, 0xfb, 0x03, 0x0c, 15]);
  });

  it('radius 하한 1·상한 255', () => {
    const [p] = encodeSetPadTable([e('SNARE', 0, 0, 0.1), e('HIHAT', 0, 0, 500)], true);
    expect(p[7]).toBe(1);
    expect(p[13]).toBe(255);
  });

  it('페달 항목은 throw', () => {
    expect(() => encodeSetPadTable([e('KICK')], true)).toThrow();
    expect(() => encodeSetPadTable([e('HIHAT_PEDAL')], true)).toThrow();
  });

  it('빈 배열: clearFirst면 지우기 1패킷, 아니면 없음', () => {
    expect(encodeSetPadTable([], true).map((x) => [...x])).toEqual([[0x15, 0x80]]);
    expect(encodeSetPadTable([], false)).toEqual([]);
  });
});

describe('STICK_PARAMS', () => {
  it('14개, 0x08 없음, id 오름차순', () => {
    expect(STICK_PARAMS).toHaveLength(14);
    expect(STICK_PARAMS.some((p) => p.id === 0x08)).toBe(false);
    const ids = STICK_PARAMS.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
  it('stickParamById·기본값·범위', () => {
    expect(stickParamById(0x02)).toMatchObject({ key: 'brakeRatio', defaultValue: 30, min: 0, max: 100 });
    expect(stickParamById(0x0f)).toMatchObject({ defaultValue: 1000, max: 32767 });
    expect(stickParamById(0x08)).toBeUndefined();
    for (const p of STICK_PARAMS) expect(p.defaultValue).toBeGreaterThanOrEqual(p.min);
  });
  it('펌웨어별 기본값: Feather는 4개만 다르다', () => {
    expect(firmwareOfMajor(0)).toBe('nucleo');
    expect(firmwareOfMajor(1)).toBe('feather');
    const diff = STICK_PARAMS.filter((p) => stickParamDefault(p, 'nucleo') !== stickParamDefault(p, 'feather')).map((p) => p.id);
    expect(diff).toEqual([0x0a, 0x0b, 0x0e, 0x0f]);
    const val = (id: number, fw: 'nucleo' | 'feather') => stickParamDefault(stickParamById(id)!, fw);
    expect([0x0a, 0x0b, 0x0e, 0x0f].map((id) => val(id, 'nucleo'))).toEqual([30, 400, 3000, 1000]);
    expect([0x0a, 0x0b, 0x0e, 0x0f].map((id) => val(id, 'feather'))).toEqual([60, 160, 800, 1200]);
    for (const p of STICK_PARAMS) expect(stickParamDefault(p, 'feather')).toBeGreaterThanOrEqual(p.min);
  });
});

describe('decodeSetPadTable', () => {
  const e = (pad: keyof typeof PAD_CODE, el = 0, az = 0, r = 10) => ({ pad, elevationDeg: el, azimuthDeg: az, radiusDeg: r });

  it('encode → decode 왕복: 3패킷의 clear 비트·항목·0.5° 반경', () => {
    const entries = [e('CRASH', 10.25, -20.5, 7.5), e('HIHAT', -1.4, -31.2, 10), e('SNARE', -12.6, -9.6, 11.5), e('RIDE', 16.8, 36, 13)];
    const packets = encodeSetPadTable(entries, true);
    const decoded = packets.map((p) => decodeSetPadTable(p));
    expect(decoded.map((d) => d?.clear)).toEqual([true, false]);
    expect(decoded.flatMap((d) => d?.entries ?? [])).toEqual(entries);
  });

  it('지우기 전용 패킷은 clear=true·항목 0', () => {
    expect(decodeSetPadTable(new Uint8Array([0x15, 0x80]))).toEqual({ clear: true, entries: [] });
  });

  it('타입이 다르거나 길이가 안 맞으면 null', () => {
    expect(decodeSetPadTable(new Uint8Array([0x14, 0x01, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(decodeSetPadTable(new Uint8Array([0x15, 0x02, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('v0.8 STATUS 비트 5(설정 전)', () => {
  it('FLAG_UNCONFIGURED는 0x20', () => {
    expect(FLAG_UNCONFIGURED).toBe(0x20);
  });

  it('decodePacket: 비트 5가 서면 unconfigured true, role은 그대로', () => {
    expect(decodePacket(new Uint8Array([0x03, 0x21, 80, 0, 1, 0]), 0)).toMatchObject({ kind: 'status', role: 1, unconfigured: true });
    expect(decodePacket(new Uint8Array([0x03, 0x01, 80, 0, 1, 0]), 0)).toMatchObject({ role: 1, unconfigured: false });
  });

  it('parsePacket: unconfigured가 이벤트에 실린다', () => {
    expect(parsePacket(new Uint8Array([0x03, 0x20, 50, 0, 1, 0]), 0)).toMatchObject({ kind: 'status', stickId: 0, unconfigured: true });
    expect(parsePacket(new Uint8Array([0x03, 0x00, 50, 0, 1, 0]), 0)).toMatchObject({ unconfigured: false });
  });

  it('role 2·3 STATUS는 비트 5와 무관하게 pedalStatus(손 status 아님)', () => {
    expect(parsePacket(new Uint8Array([0x03, 0x22, 50, 0, 1, 0]), 0)).toEqual({
      kind: 'pedalStatus',
      foot: 2,
      connected: true,
      batteryPct: 50,
    });
  });

  it('PEDAL(0x08): role 2만 pedal 이벤트, role 3·손·짧은 패킷은 버린다', () => {
    const t = 1_500_000; // µs
    expect(parsePacket(buildPedal(2, 1, t), 7)).toEqual({ kind: 'pedal', foot: 2, closed: true, timestamp: 1500, recvTime: 7 });
    expect(parsePacket(buildPedal(2, 0, t), 7)).toMatchObject({ kind: 'pedal', closed: false });
    expect(parsePacket(buildPedal(3, 1, t), 7)).toBeNull();
    expect(parsePacket(new Uint8Array([0x08, 0, 1, 0, 0, 0, 0]), 7)).toBeNull();
    expect(decodePacket(buildPedal(2, 1, t), 0)).toMatchObject({ kind: 'pedal', role: 2, state: 1, timestampUs: t });
    expect(decodePacket(buildPedal(2, 1, t).slice(0, 6), 0)).toMatchObject({ kind: 'error', reason: 'short', type: 0x08 });
  });

  it('footOf: 2·3만 발, 그 밖은 null', () => {
    expect([footOf(0), footOf(1), footOf(2), footOf(3)]).toEqual([null, null, 2, 3]);
  });

  it('handOf: 0·1만 손, 그 밖은 null', () => {
    expect([handOf(0), handOf(1), handOf(2), handOf(3)]).toEqual([0, 1, null, null]);
  });
});

describe('encodeSetPadTable perPacket', () => {
  const e = (pad: keyof typeof PAD_CODE) => ({ pad, elevationDeg: 0, azimuthDeg: 0, radiusDeg: 10 });
  const pads = ['CRASH', 'HIHAT', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE'] as const;

  it('perPacket 2: 7개 → 4패킷(2·2·2·1), 길이 ≤ 14바이트, ctrl 0x82·0x02·0x02·0x01', () => {
    const p = encodeSetPadTable(pads.map(e), true, 2);
    expect(p.map((x) => x[1])).toEqual([0x82, 0x02, 0x02, 0x01]);
    expect(p.map((x) => x.length)).toEqual([14, 14, 14, 8]);
    // ROUTE(2바이트)로 감싸도 16바이트 이하
    expect(p.every((x) => encodeRoute(1, x).length <= 20)).toBe(true);
  });

  it('perPacket 1: 패킷마다 패드 1개', () => {
    const p = encodeSetPadTable(pads.slice(0, 3).map(e), false, 1);
    expect(p.map((x) => x[1])).toEqual([1, 1, 1]);
  });

  it('기본값은 3(기존 동작)', () => {
    expect(encodeSetPadTable(pads.map(e), true).map((x) => x.length)).toEqual([20, 20, 8]);
  });

  it('범위 밖(0·4·소수)은 RangeError', () => {
    expect(() => encodeSetPadTable(pads.map(e), true, 0)).toThrow(RangeError);
    expect(() => encodeSetPadTable(pads.map(e), true, 4)).toThrow(RangeError);
    expect(() => encodeSetPadTable(pads.map(e), true, 1.5)).toThrow(RangeError);
  });

  it('왕복: 2개씩 나눈 패킷도 decodeSetPadTable로 읽힌다', () => {
    const p = encodeSetPadTable(pads.slice(0, 3).map(e), true, 2);
    expect(decodeSetPadTable(p[0])).toMatchObject({ clear: true });
    expect(decodeSetPadTable(p[0])!.entries.length).toBe(2);
    expect(decodeSetPadTable(p[1])).toMatchObject({ clear: false });
  });
});

describe('parsePacket 페달(PLAY-002)', () => {
  const ts = 2_000_000; // µs

  // 인수 조건: role 3 HIT pad 7 → KICK 타격, role 2 pad 8 → HIHAT_PEDAL
  it('role 3 HIT pad 7은 KICK(foot 3), role 2 HIT pad 8은 HIHAT_PEDAL(foot 2), stickId null·velocity 100', () => {
    const kick = parsePacket(buildHit({ role: 3, seq: 5, timestampUs: ts, pad: PAD_CODE.KICK, velocity: 100, marginDeg: 25.5 }), 9);
    expect(kick).toMatchObject({ kind: 'hit', stickId: null, foot: 3, pad: 'KICK', velocity: 100, timestamp: 2000, seq: 5 });
    const pedal = parsePacket(buildHit({ role: 2, seq: 6, timestampUs: ts, pad: PAD_CODE.HIHAT_PEDAL, velocity: 100 }), 9);
    expect(pedal).toMatchObject({ kind: 'hit', stickId: null, foot: 2, pad: 'HIHAT_PEDAL', velocity: 100 });
  });

  // 인수 조건: role 2 STATUS → pedalStatus{foot, batteryPct}
  it('role 2 STATUS는 pedalStatus{foot 2, batteryPct}', () => {
    const b = buildStatus({ role: 2, batteryPct: 66, rssi: -40, fwMajor: 3, fwMinor: 0 });
    expect(parsePacket(b, 0)).toEqual({ kind: 'pedalStatus', foot: 2, connected: true, batteryPct: 66 });
  });

  // 인수 조건: PEDAL state 1/0 → pedal{closed}, timestamp = us/1000
  it('role 2 PEDAL state 1/0은 closed true/false, timestamp는 us/1000', () => {
    expect(parsePacket(buildPedal(2, 1, ts), 3)).toEqual({ kind: 'pedal', foot: 2, closed: true, timestamp: 2000, recvTime: 3 });
    expect(parsePacket(buildPedal(2, 0, ts), 3)).toEqual({ kind: 'pedal', foot: 2, closed: false, timestamp: 2000, recvTime: 3 });
  });

  // 인수 조건: 그 밖의 role·종류는 버린다
  it('role 3 PEDAL, 손 role PEDAL, 발 POSE는 null', () => {
    expect(parsePacket(buildPedal(3, 1, ts), 0)).toBeNull();
    const handPedal = buildPedal(2, 1, ts);
    handPedal[1] = 0; // 손 role로 바꾼 PEDAL
    expect(parsePacket(handPedal, 0)).toBeNull();
    handPedal[1] = 1;
    expect(parsePacket(handPedal, 0)).toBeNull();
    expect(parsePacket(buildPose({ role: 2, timestampUs: ts, elevationDeg: 0, azimuthDeg: 0, rollDeg: 0 }), 0)).toBeNull();
    expect(parsePacket(buildPose({ role: 3, timestampUs: ts, elevationDeg: 0, azimuthDeg: 0, rollDeg: 0 }), 0)).toBeNull();
  });

  // 인수 조건: 0x08이 badType으로 버려지지 않는다
  it('decodePacket 0x08: DecodedPedal{role, state, timestampUs}, 길이 7 미만은 short 오류', () => {
    expect(decodePacket(buildPedal(3, 0, 123_456), 4)).toMatchObject({ kind: 'pedal', role: 3, state: 0, timestampUs: 123_456, recvTime: 4 });
    for (const n of [2, 6]) {
      expect(decodePacket(buildPedal(2, 1, ts).slice(0, n), 0)).toMatchObject({ kind: 'error', reason: 'short', type: 0x08 });
    }
  });
});

describe('encodeHapticWave', () => {
  it('[0x12, 파형, 0] — 세 번째 바이트 0은 라이브러리 파형 1회', () => {
    expect([...encodeHapticWave(4)]).toEqual([0x12, 4, 0]);
  });

  it('파형 번호는 1~123으로 자른다', () => {
    expect([...encodeHapticWave(0)]).toEqual([0x12, 1, 0]);
    expect([...encodeHapticWave(-5)]).toEqual([0x12, 1, 0]);
    expect([...encodeHapticWave(200)]).toEqual([0x12, 123, 0]);
    expect([...encodeHapticWave(123)]).toEqual([0x12, 123, 0]);
  });

  it('ROUTE로 감싸면 그 손 마스크가 앞에 붙는다', () => {
    expect([...encodeRoute(1, encodeHapticWave(1))]).toEqual([0x70, 0b10, 0x12, 1, 0]);
  });
});
