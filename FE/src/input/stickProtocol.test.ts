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
  PAD_NONE,
  decodePacket,
  encodeHaptic,
  encodeResetPose,
  encodeSetMode,
  encodeSync,
  padFromCode,
  parsePacket,
} from './stickProtocol';

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
    });
  });

  it('syncAck t1은 ms', () => {
    const b = new Uint8Array(10);
    const v = new DataView(b.buffer);
    b[0] = 0x04;
    v.setUint32(2, 100, true);
    v.setUint32(6, 2_500_000, true);
    expect(parsePacket(b, 0)).toEqual({ kind: 'syncAck', t0: 100, t1: 2500 });
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
