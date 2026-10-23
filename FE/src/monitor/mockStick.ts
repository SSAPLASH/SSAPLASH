// 모의 스틱. 하드웨어 없이 모든 패널이 값을 보이도록 packetTap에 패킷을 흘려 넣고, 명령에는 PARAM_ACK 등으로 답한다.
// 패킷 빌더(buildHit 등)는 stickProtocol 디코더의 역변환이라 테스트에서도 바이트 배열을 만들 때 쓴다.
// 판정 경로에는 들어가지 않는다(packetTap만 사용).
import { packetTap } from '@/input/packetTap';
import {
  CommandType,
  PAD_CODE,
  PacketType,
  PARAM_ACK_END,
  PARAM_ACK_PAD_TABLE,
  PARAM_ACK_RESET_POSE,
  PARAM_ACK_YAW_OFFSET,
  STICK_PARAMS,
  stickParamById,
} from '@/input/stickProtocol';
import { STICK_PADS } from '@/domain/pads';

type Role = 0 | 1;

const clampI16 = (n: number): number => Math.max(-32768, Math.min(32767, Math.round(n)));
const clampU8 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const u32 = (n: number): number => Math.round(n) >>> 0;

export interface HitFields {
  role?: Role;
  seq: number;
  timestampUs: number;
  /** PAD_CODE 값 또는 0xFF(판정 못 함) */
  pad: number;
  marginDeg?: number;
  elevationDeg?: number;
  azimuthDeg?: number;
  peakSpeedDps?: number;
  velocity?: number;
  swingMs?: number;
  lateralDeg?: number;
  decel?: number;
  magAnomaly?: boolean;
  ambiguous?: boolean;
}

/** HIT 20바이트. flags: 비트 0–1 role, 3 지자기 이상, 4 판정 애매 */
export function buildHit(f: HitFields): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(20);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PacketType.HIT);
  v.setUint8(1, ((f.role ?? 0) & 3) | (f.magAnomaly ? 0x08 : 0) | (f.ambiguous ? 0x10 : 0));
  v.setUint8(2, f.seq & 0xff);
  v.setUint32(3, u32(f.timestampUs), true);
  v.setUint8(7, f.pad & 0xff);
  v.setUint8(8, clampU8((f.marginDeg ?? 0) * 10));
  v.setInt16(9, clampI16((f.elevationDeg ?? 0) * 100), true);
  v.setInt16(11, clampI16((f.azimuthDeg ?? 0) * 100), true);
  v.setUint16(13, Math.max(0, Math.min(65535, Math.round(f.peakSpeedDps ?? 0))), true);
  v.setUint8(15, clampU8(f.velocity ?? 0));
  v.setUint8(16, clampU8(f.swingMs ?? 0));
  v.setInt16(17, clampI16((f.lateralDeg ?? 0) * 10), true);
  v.setUint8(19, clampU8((f.decel ?? 0) * 10));
  return buf;
}

export interface PoseFields {
  role?: Role;
  timestampUs: number;
  elevationDeg: number;
  azimuthDeg: number;
  rollDeg: number;
  /** null이면 12바이트 패킷(seq 없음) */
  seq?: number | null;
}

export function buildPose(f: PoseFields): Uint8Array<ArrayBuffer> {
  const hasSeq = f.seq !== null && f.seq !== undefined;
  const buf = new Uint8Array(hasSeq ? 13 : 12);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PacketType.POSE);
  v.setUint8(1, (f.role ?? 0) & 3);
  v.setUint32(2, u32(f.timestampUs), true);
  v.setInt16(6, clampI16(f.elevationDeg * 100), true);
  v.setInt16(8, clampI16(f.azimuthDeg * 100), true);
  v.setInt16(10, clampI16(f.rollDeg * 100), true);
  if (hasSeq) v.setUint8(12, (f.seq as number) & 0xff);
  return buf;
}

export function buildStatus(f: {
  role?: Role;
  batteryPct: number | null;
  rssi: number;
  fwMajor: number;
  fwMinor: number;
}): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(6);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PacketType.STATUS);
  v.setUint8(1, (f.role ?? 0) & 3);
  v.setUint8(2, f.batteryPct === null ? 0xff : clampU8(f.batteryPct));
  v.setInt8(3, Math.max(-128, Math.min(127, Math.round(f.rssi))));
  v.setUint8(4, f.fwMajor & 0xff);
  v.setUint8(5, f.fwMinor & 0xff);
  return buf;
}

export function buildSyncAck(f: { role?: Role; t0Ms: number; t1Us: number }): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(10);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PacketType.SYNC_ACK);
  v.setUint8(1, (f.role ?? 0) & 3);
  v.setUint32(2, u32(f.t0Ms), true);
  v.setUint32(6, u32(f.t1Us), true);
  return buf;
}

export function buildBridgeStats(f: { okFrames: number; crcErrors: number; resyncCount: number }): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(14);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PacketType.BRIDGE_STATS);
  v.setUint32(2, u32(f.okFrames), true);
  v.setUint32(6, u32(f.crcErrors), true);
  v.setUint32(10, u32(f.resyncCount), true);
  return buf;
}

export function buildLog(text: string, role: Role = 0): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(2 + text.length);
  buf[0] = PacketType.LOG;
  buf[1] = role & 3;
  for (let i = 0; i < text.length; i++) buf[2 + i] = text.charCodeAt(i) & 0xff;
  return buf;
}

export function buildParamAck(f: { role?: Role; paramId: number; value: number }): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(5);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PacketType.PARAM_ACK);
  v.setUint8(1, (f.role ?? 0) & 3);
  v.setUint8(2, f.paramId & 0xff);
  v.setInt16(3, clampI16(f.value), true);
  return buf;
}

export interface MockStartOptions {
  sticks?: 1 | 2;
  /** 스틱당 POSE 주기(Hz). 기본 50 */
  poseHz?: number;
  /** HIT 간격(ms). 기본 1000 */
  hitIntervalMs?: number;
}

export interface MockDeps {
  now?: () => number;
}

/** 모의 시계 시작값: 5초 뒤 u32 µs 랩어라운드가 실제로 일어나게 한다 */
const CLOCK_START_US = 2 ** 32 - 5_000_000;
const STATUS_INTERVAL_MS = 5000;
const POSE_SEQ_SKIP_EVERY = 100;
const HIT_SEQ_SKIP_EVERY = 10;
const HIT_AMBIGUOUS_EVERY = 20;
const HIT_TRUNCATED_EVERY = 50;
/** 명령 응답 간격(ms) */
const REPLY_GAP_MS = 20;

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

export class MockStick {
  private deps: MockDeps;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private intervals: ReturnType<typeof setInterval>[] = [];
  private _running = false;
  private startNow = 0;
  private sticks: 1 | 2 = 1;
  private poseSeq: [number, number] = [0, 0];
  private poseCount: [number, number] = [0, 0];
  private hitSeq: [number, number] = [0, 0];
  private hitCount = 0;
  private bridgeOk = 0;
  private bridgeCrc = 0;
  private bridgeTick = 0;
  private padCount = 0;
  private lastElevationDeg = 0;

  constructor(deps: MockDeps = {}) {
    this.deps = deps;
  }

  get running(): boolean {
    return this._running;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  /** 모의 시계 µs (u32 범위로 접는다) */
  private clockUs(): number {
    return (Math.round((this.now() - this.startNow) * 1000) + CLOCK_START_US) % 2 ** 32;
  }

  private publish(bytes: Uint8Array, dir: 'in' | 'out' = 'in'): void {
    packetTap.publish({ dir, transport: 'mock', stickId: null, bytes, recvTime: this.now() });
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  start(opts: MockStartOptions = {}): void {
    if (this._running) return;
    this._running = true;
    this.startNow = this.now();
    this.sticks = opts.sticks ?? 1;
    const poseHz = opts.poseHz ?? 50;
    const hitMs = opts.hitIntervalMs ?? 1000;
    this.poseSeq = [0, 0];
    this.poseCount = [0, 0];
    this.hitSeq = [0, 0];
    this.hitCount = 0;
    this.bridgeOk = 0;
    this.bridgeCrc = 0;
    this.bridgeTick = 0;
    this.padCount = 0;

    this.publish(buildLog('BOOT 0.1 mock000'));
    this.emitStatus();
    this.intervals.push(setInterval(() => this.emitStatus(), STATUS_INTERVAL_MS));
    this.intervals.push(setInterval(() => this.emitPose(), 1000 / poseHz));
    this.intervals.push(setInterval(() => this.emitHit(hitMs), hitMs));
    this.intervals.push(setInterval(() => this.emitBridge(), 1000));
  }

  stop(): void {
    this._running = false;
    for (const i of this.intervals) clearInterval(i);
    this.intervals = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private roles(): Role[] {
    return this.sticks === 2 ? [0, 1] : [0];
  }

  private emitStatus(): void {
    for (const role of this.roles()) {
      this.publish(buildStatus({ role, batteryPct: null, rssi: -60, fwMajor: 0, fwMinor: 1 }));
    }
  }

  /** 스틱마다 poseHz로 13바이트 POSE. 100번째마다 seq를 1 건너뛴다 */
  private emitPose(): void {
    const sec = (this.now() - this.startNow) / 1000;
    for (const role of this.roles()) {
      this.poseCount[role]++;
      this.poseSeq[role] = (this.poseSeq[role] + (this.poseCount[role] % POSE_SEQ_SKIP_EVERY === 0 ? 2 : 1)) & 0xff;
      const elevationDeg = 20 * Math.sin((2 * Math.PI * sec) / 4 + role);
      const azimuthDeg = 30 * Math.sin((2 * Math.PI * sec) / 6 + role);
      if (role === 0) this.lastElevationDeg = elevationDeg;
      this.publish(
        buildPose({ role, timestampUs: this.clockUs(), elevationDeg, azimuthDeg, rollDeg: 5 * Math.sin(sec), seq: this.poseSeq[role] }),
      );
    }
  }

  /** HIT 한 건. 스틱이 2개면 role을 번갈아 쓴다 */
  private emitHit(hitMs: number): void {
    this.hitCount++;
    const role = this.roles()[(this.hitCount - 1) % this.sticks];
    this.hitSeq[role] = (this.hitSeq[role] + (this.hitCount % HIT_SEQ_SKIP_EVERY === 0 ? 2 : 1)) & 0xff;
    const pad = STICK_PADS[Math.floor(Math.random() * STICK_PADS.length)];
    const bytes = buildHit({
      role,
      seq: this.hitSeq[role],
      timestampUs: this.clockUs(),
      pad: PAD_CODE[pad],
      marginDeg: rand(1, 8),
      elevationDeg: this.lastElevationDeg,
      azimuthDeg: rand(-30, 30),
      peakSpeedDps: rand(500, 750),
      velocity: rand(40, 120),
      swingMs: rand(60, 200),
      lateralDeg: rand(-5, 5),
      decel: rand(55, 126),
      ambiguous: this.hitCount % HIT_AMBIGUOUS_EVERY === 0,
    });
    // 50번째마다 한 바이트 모자란 오류 패킷
    this.publish(this.hitCount % HIT_TRUNCATED_EVERY === 0 ? bytes.slice(0, 19) : bytes);
    // HIT 사이에 가끔 거른 스윙 LOG
    if (this.hitCount % 3 === 0) {
      const text = this.hitCount % 6 === 0 ? 'drop slow 512' : 'drop weak 320';
      this.later(hitMs / 2, () => this.publish(buildLog(text, role)));
    }
  }

  private emitBridge(): void {
    this.bridgeTick++;
    this.bridgeOk += 60 * this.sticks + 2;
    if (this.bridgeTick % 30 === 0) this.bridgeCrc++;
    this.publish(buildBridgeStats({ okFrames: this.bridgeOk, crcErrors: this.bridgeCrc, resyncCount: 0 }));
  }

  /** 명령 바가 보낸 바이트를 dir:'out'으로 publish한 뒤 해당 응답을 흘린다 */
  handleCommand(bytes: Uint8Array): void {
    if (!this._running || bytes.length === 0) return;
    this.publish(bytes, 'out');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    switch (bytes[0]) {
      case CommandType.GET_PARAMS: {
        STICK_PARAMS.forEach((p, i) => {
          this.later(REPLY_GAP_MS * (i + 1), () => this.publish(buildParamAck({ paramId: p.id, value: p.defaultValue })));
        });
        this.later(REPLY_GAP_MS * (STICK_PARAMS.length + 1), () =>
          this.publish(buildParamAck({ paramId: PARAM_ACK_END, value: STICK_PARAMS.length })),
        );
        break;
      }
      case CommandType.SET_PARAM: {
        if (bytes.length < 4) break;
        const id = v.getUint8(1);
        const value = v.getInt16(2, true);
        const meta = stickParamById(id);
        // 범위 밖 값은 잘라서 되돌려 "잘림" 표시를 볼 수 있게 한다
        const applied = meta ? Math.max(meta.min, Math.min(meta.max, value)) : value;
        this.later(REPLY_GAP_MS, () => this.publish(buildParamAck({ paramId: id, value: applied })));
        break;
      }
      case CommandType.SET_PAD_TABLE: {
        if (bytes.length < 2) break;
        const ctrl = bytes[1];
        this.padCount = (ctrl & 0x80 ? 0 : this.padCount) + (ctrl & 0x0f);
        const total = this.padCount;
        this.later(REPLY_GAP_MS, () => this.publish(buildParamAck({ paramId: PARAM_ACK_PAD_TABLE, value: total })));
        break;
      }
      case CommandType.SET_YAW_OFFSET: {
        if (bytes.length < 3) break;
        const value = v.getInt16(1, true);
        this.later(REPLY_GAP_MS, () => this.publish(buildParamAck({ paramId: PARAM_ACK_YAW_OFFSET, value })));
        break;
      }
      case CommandType.RESET_POSE: {
        const value = Math.round(this.lastElevationDeg * 100);
        this.later(REPLY_GAP_MS, () => this.publish(buildParamAck({ paramId: PARAM_ACK_RESET_POSE, value })));
        break;
      }
      case CommandType.SYNC: {
        if (bytes.length < 5) break;
        const t0Ms = v.getUint32(1, true);
        this.later(REPLY_GAP_MS / 4, () => this.publish(buildSyncAck({ t0Ms, t1Us: this.clockUs() })));
        break;
      }
      default:
        // SET_MODE·HAPTIC은 무응답
        break;
    }
  }
}

export const mockStick = new MockStick();
