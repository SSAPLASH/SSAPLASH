// 스틱 ↔ 브라우저 바이너리 프로토콜. BLE와 WebSocket(바이너리 프레임)이 공유한다.
// 사양 원문: Docs/Service Design/스틱 통신 프로토콜.md — 바꾸면 양쪽을 같이 고친다.
import type { StickEvent, StickId } from '@/domain/events';

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

/** 스케일: 각도 ×100 (i16), 가속도 g ×100 (u16) */
const ANGLE_SCALE = 100;
const ACCEL_SCALE = 100;

export interface SyncAck {
  kind: 'syncAck';
  /** 브라우저가 SYNC에 실어 보낸 t0 (ms, u32로 잘림) */
  t0: number;
  /** 센서가 SYNC를 받은 센서 시계 (ms) */
  t1: number;
}

export type ParsedPacket = StickEvent | SyncAck | null;

/**
 * 수신 패킷 파싱. 알 수 없는 타입이면 null.
 * recvTime은 호출자가 패킷을 받은 performance.now().
 */
export function parsePacket(data: DataView, recvTime: number): ParsedPacket {
  if (data.byteLength < 2) return null;
  const type = data.getUint8(0);
  const stickId = data.getUint8(1) as StickId;
  switch (type) {
    case PacketType.HIT: {
      // [0]type [1]stick [2..5]ts u32 [6..7]peak u16 [8..9]pitch i16 [10..11]yaw i16 [12..13]seq u16
      if (data.byteLength < 12) return null;
      return {
        kind: 'hit',
        stickId,
        timestamp: data.getUint32(2, true),
        recvTime,
        peakAccel: data.getUint16(6, true) / ACCEL_SCALE,
        pitch: data.getInt16(8, true) / ANGLE_SCALE,
        yaw: data.getInt16(10, true) / ANGLE_SCALE,
      };
    }
    case PacketType.POSE: {
      // [0]type [1]stick [2..5]ts u32 [6..7]pitch i16 [8..9]yaw i16 [10..11]roll i16(미사용)
      if (data.byteLength < 10) return null;
      return {
        kind: 'pose',
        stickId,
        timestamp: data.getUint32(2, true),
        pitch: data.getInt16(6, true) / ANGLE_SCALE,
        yaw: data.getInt16(8, true) / ANGLE_SCALE,
      };
    }
    case PacketType.STATUS: {
      // [0]type [1]stick [2]battery u8 [3]rssi i8 [4]fwMajor [5]fwMinor
      if (data.byteLength < 6) return null;
      return {
        kind: 'status',
        stickId,
        connected: true,
        batteryPct: data.getUint8(2),
        rssi: data.getInt8(3),
        firmware: `${data.getUint8(4)}.${data.getUint8(5)}`,
      };
    }
    case PacketType.SYNC_ACK: {
      // [0]type [1]stick [2..5]t0 u32 [6..9]t1 u32
      if (data.byteLength < 10) return null;
      return { kind: 'syncAck', t0: data.getUint32(2, true), t1: data.getUint32(6, true) };
    }
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
