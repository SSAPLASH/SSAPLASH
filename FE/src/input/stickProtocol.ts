// 스틱 ↔ 브라우저 바이너리 프로토콜. BLE와 WebSocket(바이너리 프레임)이 공유한다.
// 사양 원문: Docs/Service Design/스틱 통신 프로토콜.md — 바꾸면 양쪽을 같이 고친다.
// 현재 구현 기준: v0.7(회신 기준, 원문 대조 전 — PARAM_ACK·SWING·0x14~0x17 보류)
import type { StickEvent, StickId } from '@/domain/events';
import type { PadId } from '@/domain/pads';

export const STICK_SERVICE_UUID = 'a7d50001-9a3c-4f2e-b1c8-5f0e2d7c0001';
/** 스틱 → 브라우저. Notify. 모든 패킷이 이 특성 하나로 온다 (첫 바이트 = 타입) */
export const STICK_NOTIFY_UUID = 'a7d50002-9a3c-4f2e-b1c8-5f0e2d7c0001';
/** 브라우저 → 스틱. Write Without Response */
export const STICK_CONTROL_UUID = 'a7d50003-9a3c-4f2e-b1c8-5f0e2d7c0001';

export const PacketType = {
  HIT: 0x01,
  POSE: 0x02,
  STATUS: 0x03,
  SYNC_ACK: 0x04,
  SWING: 0x05,
  PARAM_ACK: 0x06,
  BRIDGE_STATS: 0x7e,
  LOG: 0x7f,
} as const;

export const CommandType = {
  SYNC: 0x10,
  SET_MODE: 0x11,
  HAPTIC: 0x12,
  RESET_POSE: 0x13,
} as const;

export const StreamMode = {
  HIT_ONLY: 0,
  HIT_AND_POSE: 1,
  RAW_COLLECT: 2,
} as const;

/** 프로토콜 패드 번호 v0.7. 화면 순서(LANE_PADS)와 무관한 별도 표 */
export const PAD_CODE: Record<PadId, number> = {
  CRASH: 0,
  HIHAT: 1,
  SNARE: 2,
  SMALL_TOM: 3,
  MID_TOM: 4,
  FLOOR_TOM: 5,
  RIDE: 6,
  KICK: 7,
  HIHAT_PEDAL: 8,
};

/** HIT pad 바이트: 스틱이 패드를 판정하지 못함 */
export const PAD_NONE = 0xff;

const PAD_BY_CODE: PadId[] = [
  'CRASH',
  'HIHAT',
  'SNARE',
  'SMALL_TOM',
  'MID_TOM',
  'FLOOR_TOM',
  'RIDE',
  'KICK',
  'HIHAT_PEDAL',
];

/** 패드 번호 → PadId. 0~8만 변환하고 0xFF·9 이상은 null */
export function padFromCode(code: number): PadId | null {
  return Number.isInteger(code) && code >= 0 && code < PAD_BY_CODE.length ? PAD_BY_CODE[code] : null;
}

export interface SyncAck {
  kind: 'syncAck';
  /** 브라우저가 SYNC에 실어 보낸 t0 (ms, u32로 잘림) */
  t0: number;
  /** 센서가 SYNC를 받은 센서 시계 (ms) */
  t1: number;
}

/** 모든 디코드 결과가 공통으로 갖는 값 */
interface PacketBase {
  /** 호출자가 패킷을 받은 performance.now() */
  recvTime: number;
}

/** flags 바이트를 푼 값 (HIT·POSE·STATUS·SYNC_ACK·LOG 공통) */
interface FlaggedBase extends PacketBase {
  flags: number;
  /** flags 비트 0–1: 0 왼손, 1 오른손 */
  role: number;
}

export interface DecodedHit extends FlaggedBase {
  kind: 'hit';
  /** flags 비트 3: 지자기 이상 */
  magAnomaly: boolean;
  /** flags 비트 4: 판정 애매 */
  ambiguous: boolean;
  seq: number;
  /** 스틱 시계 µs 원시값 (u32, 펼치기·ms 환산은 호출자) */
  timestampUs: number;
  /** 스틱이 판정한 패드. 0xFF·범위 밖이면 null */
  pad: PadId | null;
  marginDeg: number;
  elevationDeg: number;
  azimuthDeg: number;
  peakSpeedDps: number;
  /** 스틱이 계산한 세기 0~127 */
  velocity: number;
  swingMs: number;
  lateralDeg: number;
  decel: number;
}

export interface DecodedPose extends FlaggedBase {
  kind: 'pose';
  timestampUs: number;
  elevationDeg: number;
  azimuthDeg: number;
  rollDeg: number;
  /** 13바이트 패킷만 값이 있다 */
  seq: number | null;
}

export interface DecodedStatus extends FlaggedBase {
  kind: 'status';
  /** 0xFF(측정 불가)면 null */
  batteryPct: number | null;
  rssi: number;
  fwMajor: number;
  fwMinor: number;
}

export interface DecodedSyncAck extends FlaggedBase {
  kind: 'syncAck';
  /** 브라우저가 보낸 t0 그대로 (ms) */
  t0Ms: number;
  /** 스틱 시계 (µs) */
  t1Us: number;
}

export interface DecodedBridgeStats extends PacketBase {
  kind: 'bridgeStats';
  okFrames: number;
  crcErrors: number;
  resyncCount: number;
}

export interface DecodedLog extends FlaggedBase {
  kind: 'log';
  text: string;
}

/** 형식을 아직 모르는 패킷(SWING·PARAM_ACK). hex 보관용 */
export interface DecodedUnsupported extends PacketBase {
  kind: 'unsupported';
  type: number;
  bytes: Uint8Array;
}

export interface DecodedError extends PacketBase {
  kind: 'error';
  reason: 'short' | 'badType';
  /** 첫 바이트. 비어 있으면 null */
  type: number | null;
  bytes: Uint8Array;
}

export type DecodedPacket =
  | DecodedHit
  | DecodedPose
  | DecodedStatus
  | DecodedSyncAck
  | DecodedBridgeStats
  | DecodedLog
  | DecodedUnsupported
  | DecodedError;

/** 타입별 최소 길이 */
const MIN_LEN: Record<number, number> = {
  [PacketType.HIT]: 20,
  [PacketType.POSE]: 12,
  [PacketType.STATUS]: 6,
  [PacketType.SYNC_ACK]: 10,
  [PacketType.BRIDGE_STATS]: 14,
  [PacketType.LOG]: 2,
};

/**
 * 바이트 → 전체 필드 디코드. 리틀엔디언. 각도는 도(÷100), lateral·margin·decel은 ÷10,
 * 시각은 µs 원시값 그대로.
 * recvTime은 호출자가 패킷을 받은 performance.now().
 */
export function decodePacket(bytes: Uint8Array, recvTime: number): DecodedPacket {
  if (bytes.length < 2) return { kind: 'error', reason: 'short', type: bytes.length ? bytes[0] : null, bytes, recvTime };
  const type = bytes[0];
  if (type === PacketType.SWING || type === PacketType.PARAM_ACK) {
    return { kind: 'unsupported', type, bytes, recvTime };
  }
  const min = MIN_LEN[type];
  if (min === undefined) return { kind: 'error', reason: 'badType', type, bytes, recvTime };
  if (bytes.length < min) return { kind: 'error', reason: 'short', type, bytes, recvTime };

  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[1];
  const base = { recvTime, flags, role: flags & 0x03 };
  switch (type) {
    case PacketType.HIT:
      return {
        kind: 'hit',
        ...base,
        magAnomaly: (flags & 0x08) !== 0,
        ambiguous: (flags & 0x10) !== 0,
        seq: v.getUint8(2),
        timestampUs: v.getUint32(3, true),
        pad: padFromCode(v.getUint8(7)),
        marginDeg: v.getUint8(8) / 10,
        elevationDeg: v.getInt16(9, true) / 100,
        azimuthDeg: v.getInt16(11, true) / 100,
        peakSpeedDps: v.getUint16(13, true),
        velocity: v.getUint8(15),
        swingMs: v.getUint8(16),
        lateralDeg: v.getInt16(17, true) / 10,
        decel: v.getUint8(19) / 10,
      };
    case PacketType.POSE:
      return {
        kind: 'pose',
        ...base,
        timestampUs: v.getUint32(2, true),
        elevationDeg: v.getInt16(6, true) / 100,
        azimuthDeg: v.getInt16(8, true) / 100,
        rollDeg: v.getInt16(10, true) / 100,
        seq: bytes.length >= 13 ? v.getUint8(12) : null,
      };
    case PacketType.STATUS: {
      const battery = v.getUint8(2);
      return {
        kind: 'status',
        ...base,
        batteryPct: battery === 0xff ? null : battery,
        rssi: v.getInt8(3),
        fwMajor: v.getUint8(4),
        fwMinor: v.getUint8(5),
      };
    }
    case PacketType.SYNC_ACK:
      return { kind: 'syncAck', ...base, t0Ms: v.getUint32(2, true), t1Us: v.getUint32(6, true) };
    case PacketType.BRIDGE_STATS:
      return {
        kind: 'bridgeStats',
        recvTime,
        okFrames: v.getUint32(2, true),
        crcErrors: v.getUint32(6, true),
        resyncCount: v.getUint32(10, true),
      };
    default: {
      // LOG (가정: [2..] ASCII, 끝의 NUL 제거)
      let text = '';
      for (let i = 2; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      return { kind: 'log', ...base, text: text.replace(/\0+$/, '') };
    }
  }
}

export type ParsedPacket = StickEvent | SyncAck | null;

/**
 * 수신 패킷 파싱. 이벤트로 바꿀 수 없는 패킷(오류·모르는 타입·bridgeStats·log)은 null.
 * hit·pose의 timestamp와 syncAck의 t1은 ms로 환산한다(ClockSync 단위).
 */
export function parsePacket(data: Uint8Array | DataView, recvTime: number): ParsedPacket {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const d = decodePacket(bytes, recvTime);
  switch (d.kind) {
    case 'hit':
      return {
        kind: 'hit',
        stickId: (d.role & 1) as StickId,
        timestamp: d.timestampUs / 1000,
        recvTime,
        // 84-c 전 임시: 피크 각속도(dps)를 기존 피크 가속도(g) 범위로 환산
        peakAccel: d.peakSpeedDps / 100,
        pitch: d.elevationDeg,
        yaw: d.azimuthDeg,
        pad: d.pad,
        velocity: d.velocity,
      };
    case 'pose':
      return {
        kind: 'pose',
        stickId: (d.role & 1) as StickId,
        timestamp: d.timestampUs / 1000,
        pitch: d.elevationDeg,
        yaw: d.azimuthDeg,
      };
    case 'status':
      return {
        kind: 'status',
        stickId: (d.role & 1) as StickId,
        connected: true,
        batteryPct: d.batteryPct ?? undefined,
        rssi: d.rssi,
        firmware: `${d.fwMajor}.${d.fwMinor}`,
      };
    case 'syncAck':
      return { kind: 'syncAck', t0: d.t0Ms, t1: d.t1Us / 1000 };
    default:
      return null;
  }
}

export function encodeSync(t0: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(5);
  const v = new DataView(buf.buffer);
  v.setUint8(0, CommandType.SYNC);
  v.setUint32(1, Math.floor(t0) >>> 0, true);
  return buf;
}

export function encodeSetMode(mode: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([CommandType.SET_MODE, mode & 0xff]);
}

export function encodeHaptic(strength: number, durationMs: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    CommandType.HAPTIC,
    Math.max(0, Math.min(255, Math.round(strength))),
    Math.max(0, Math.min(255, Math.round(durationMs / 10))),
  ]);
}

export function encodeResetPose(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([CommandType.RESET_POSE]);
}
