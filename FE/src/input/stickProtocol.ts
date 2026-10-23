// 스틱 ↔ 브라우저 바이너리 프로토콜. BLE와 WebSocket(바이너리 프레임)이 공유한다.
// 사양 원문: Docs/Service Design/스틱 통신 프로토콜.md — 바꾸면 양쪽을 같이 고친다.
// 현재 구현 기준: v0.7 원문(develop-EMB `Docs/Service Design/스틱 통신 프로토콜.md`) 대조 완료
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
  SET_PARAM: 0x14,
  SET_PAD_TABLE: 0x15,
  SET_YAW_OFFSET: 0x16,
  GET_PARAMS: 0x17,
} as const;

/** PARAM_ACK 예약 paramId: GET_PARAMS 끝 표시(value = 보낸 개수) */
export const PARAM_ACK_END = 0x00;
/** SET_PAD_TABLE 적용됨(value = 적용 후 패드 개수, 지우기 패킷이면 0부터) */
export const PARAM_ACK_PAD_TABLE = 0x20;
/** SET_YAW_OFFSET 적용됨(value = 적용된 오프셋, 0.01°) */
export const PARAM_ACK_YAW_OFFSET = 0x21;
/** RESET_POSE 적용됨(value = 그 순간 고도각, 0.01°) */
export const PARAM_ACK_RESET_POSE = 0x22;

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

export interface DecodedParamAck extends FlaggedBase {
  kind: 'paramAck';
  /** 예약 id(PARAM_ACK_*) 또는 SET_PARAM 파라미터 id */
  paramId: number;
  /** 실제로 적용된 값 (예약 id는 의미가 다르다) */
  value: number;
}

export interface DecodedSwing extends FlaggedBase {
  kind: 'swing';
  hitSeq: number;
  chunkIdx: number;
  chunkCount: number;
  /** ax ay az gx gy gz 순서로 샘플당 6개씩 이어 붙인 값 */
  samples: Int16Array;
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
  | DecodedParamAck
  | DecodedSwing
  | DecodedError;

/** 타입별 최소 길이 */
const MIN_LEN: Record<number, number> = {
  [PacketType.HIT]: 20,
  [PacketType.POSE]: 12,
  [PacketType.STATUS]: 6,
  [PacketType.SYNC_ACK]: 10,
  [PacketType.BRIDGE_STATS]: 14,
  [PacketType.LOG]: 2,
  [PacketType.SWING]: 5,
  [PacketType.PARAM_ACK]: 5,
};

/**
 * 바이트 → 전체 필드 디코드. 리틀엔디언. 각도는 도(÷100), lateral·margin·decel은 ÷10,
 * 시각은 µs 원시값 그대로.
 * recvTime은 호출자가 패킷을 받은 performance.now().
 */
export function decodePacket(bytes: Uint8Array, recvTime: number): DecodedPacket {
  if (bytes.length < 2) return { kind: 'error', reason: 'short', type: bytes.length ? bytes[0] : null, bytes, recvTime };
  const type = bytes[0];
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
    case PacketType.PARAM_ACK:
      return { kind: 'paramAck', ...base, paramId: v.getUint8(2), value: v.getInt16(3, true) };
    case PacketType.SWING: {
      // 5바이트 뒤는 12바이트(i16 × 6) 샘플의 반복. 불완전한 끝 샘플은 버린다
      const count = Math.floor((bytes.length - 5) / 12) * 6;
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) samples[i] = v.getInt16(5 + i * 2, true);
      return {
        kind: 'swing',
        ...base,
        hitSeq: v.getUint8(2),
        chunkIdx: v.getUint8(3),
        chunkCount: v.getUint8(4),
        samples,
      };
    }
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
 * 수신 패킷 파싱. 이벤트로 바꿀 수 없는 패킷(오류·모르는 타입·bridgeStats·log·paramAck·swing)은 null.
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
        marginDeg: d.marginDeg,
        ambiguous: d.ambiguous,
        peakSpeedDps: d.peakSpeedDps,
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

const clampI16 = (n: number): number => Math.max(-32768, Math.min(32767, Math.round(n)));

/** SET_PARAM: [0x14, id, value i16]. value는 반올림 후 i16 범위로 자른다 */
export function encodeSetParam(id: number, value: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(4);
  const v = new DataView(buf.buffer);
  v.setUint8(0, CommandType.SET_PARAM);
  v.setUint8(1, id & 0xff);
  v.setInt16(2, clampI16(value), true);
  return buf;
}

/** SET_YAW_OFFSET: [0x16, offset i16 (0.01°)] */
export function encodeSetYawOffset(deg: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(3);
  const v = new DataView(buf.buffer);
  v.setUint8(0, CommandType.SET_YAW_OFFSET);
  v.setInt16(1, clampI16(deg * 100), true);
  return buf;
}

/** GET_PARAMS: [0x17]. 응답은 PARAM_ACK 14개 + 끝 표시(PARAM_ACK_END) */
export function encodeGetParams(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([CommandType.GET_PARAMS]);
}

export interface PadTableEntry {
  /** 스틱 패드만 허용(페달은 throw) */
  pad: PadId;
  elevationDeg: number;
  azimuthDeg: number;
  /** 도. 0.5° 단위로 반올림해 1~255로 자른다 */
  radiusDeg: number;
}

/**
 * SET_PAD_TABLE: 3개씩 나눈 패킷 배열. [0x15, ctrl, (pad, elev i16, azim i16, radius u8) × N].
 * ctrl 비트 7 = 지우고 시작(첫 패킷만, clearFirst일 때), 비트 0–3 = 이 패킷의 패드 수.
 * 빈 배열이면 clearFirst일 때만 지우기 전용 1패킷([0x15, 0x80]), 아니면 패킷 없음.
 * 적용 확인은 PARAM_ACK_PAD_TABLE(value = 적용 후 패드 개수).
 */
export function encodeSetPadTable(entries: PadTableEntry[], clearFirst: boolean): Uint8Array<ArrayBuffer>[] {
  for (const e of entries) {
    if (PAD_CODE[e.pad] >= 7) throw new Error(`SET_PAD_TABLE은 스틱 패드만 보낼 수 있다: ${e.pad}`);
  }
  if (entries.length === 0) return clearFirst ? [new Uint8Array([CommandType.SET_PAD_TABLE, 0x80])] : [];
  const packets: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < entries.length; i += 3) {
    const chunk = entries.slice(i, i + 3);
    const buf = new Uint8Array(2 + chunk.length * 6);
    const v = new DataView(buf.buffer);
    v.setUint8(0, CommandType.SET_PAD_TABLE);
    v.setUint8(1, (i === 0 && clearFirst ? 0x80 : 0) | chunk.length);
    chunk.forEach((e, j) => {
      const o = 2 + j * 6;
      v.setUint8(o, PAD_CODE[e.pad]);
      v.setInt16(o + 1, clampI16(e.elevationDeg * 100), true);
      v.setInt16(o + 3, clampI16(e.azimuthDeg * 100), true);
      v.setUint8(o + 5, Math.max(1, Math.min(255, Math.round(e.radiusDeg * 2))));
    });
    packets.push(buf);
  }
  return packets;
}

/** SET_PARAM 파라미터 한 개의 메타. 범위는 원문에 없어 FE가 가정한 값 */
export interface StickParam {
  id: number;
  key: string;
  label: string;
  unit: string;
  defaultValue: number;
  min: number;
  max: number;
}

const param = (
  id: number,
  key: string,
  label: string,
  unit: string,
  defaultValue: number,
  min = 0,
  max = 32767,
): StickParam => ({ id, key, label, unit, defaultValue, min, max });

/** 원문 5장 파라미터 표(0x08 예약 제외 14개, id 오름차순). 기본값은 STM32+BNO055 실측 기준 */
export const STICK_PARAMS: readonly StickParam[] = [
  param(0x01, 'swingStart', '스윙 시작 속도', '°/s', 150),
  param(0x02, 'brakeRatio', '판정 감속 비율', '%', 30, 0, 100),
  param(0x03, 'minPeak', '최소 최대속도', '°/s', 400),
  param(0x04, 'debounceMs', '타격 최소 간격', 'ms', 30),
  param(0x05, 'hapticEnable', '진동 사용', '0/1', 1, 0, 1),
  param(0x06, 'hapticStrength', '진동 세기', '0~255', 200, 0, 255),
  param(0x07, 'role', '역할(손·발)', '0~3', 0, 0, 3),
  param(0x09, 'poseRateHz', 'POSE 주기', 'Hz', 50),
  param(0x0a, 'minDecel', '최소 감속률', '0.1°/s per ms', 30),
  param(0x0b, 'maxSwingMs', '최대 스윙 시간', 'ms', 400),
  param(0x0c, 'rearmUp', '재무장 상승 속도', '°/s', 50),
  param(0x0d, 'rearmIdleMs', '재무장 대기', 'ms', 150),
  param(0x0e, 'tsCorrUs', '정지 시각 보정', 'µs', 3000),
  param(0x0f, 'velMax', '벨로시티 최대 속도', '°/s', 1000),
];

export function stickParamById(id: number): StickParam | undefined {
  return STICK_PARAMS.find((p) => p.id === id);
}
