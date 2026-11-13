// 패드 테이블 동기화(손별, PLAY-004). 손마다 다른 판정 프로필의 앵커를 그 손에만 SET_PAD_TABLE로 보내고,
// PARAM_ACK_PAD_TABLE(적용 후 패드 개수)로 손별 적용을 확인한다. 보정 시작 때는 지우기 전용 패킷으로 표를 비운다(D6).
// 센서가 연결된 동안만 동작한다. input → store 직접 import는 금지라 상태는 onStatus 콜백으로 밖에 알린다(bootstrap이 liveStore에 연결).
import type { CalibrationProfile, PadTableStatus } from '@/domain/kit/calibration/calibration';
import type { StickId } from '@/domain/events';
import { STICK_PADS } from '@/domain/kit/pads';
import type { InputSource } from './source/InputSource';
import { packetTap } from './packetTap';
import { decodePacket, encodeSetPadTable, PARAM_ACK_PAD_TABLE, type PadTableEntry } from './stickProtocol';

export type { PadTableStatus };

/** 전송 후 PARAM_ACK를 기다리는 시간(ms) */
const ACK_WINDOW_MS = 500;
const STICKS: readonly StickId[] = [0, 1];

const round2 = (v: number) => Math.round(v * 100) / 100;

interface HandState {
  /** 마지막으로 보낸 표의 해시. 같은 표는 다시 보내지 않는다 */
  lastHash: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  windowOpen: boolean;
  status: PadTableStatus | null;
}

const blank = (): HandState => ({ lastHash: null, timer: null, windowOpen: false, status: null });

class PadTableSync {
  private source: InputSource | null = null;
  private offState: (() => void) | null = null;
  private offTap: (() => void) | null = null;
  private hands: [HandState, HandState] = [blank(), blank()];
  private statusCb: ((stickId: StickId, st: PadTableStatus | null) => void) | null = null;

  constructor() {
    this.subscribeTap();
  }

  /** 상태 보고 콜백 등록(1개). 이후 손별 상태가 바뀔 때마다 호출한다 */
  onStatus(cb: (stickId: StickId, st: PadTableStatus | null) => void): void {
    this.statusCb = cb;
  }

  private subscribeTap(): void {
    this.offTap?.();
    this.offTap = packetTap.subscribe((rec) => {
      if (rec.dir !== 'in') return;
      const pkt = decodePacket(rec.bytes, rec.recvTime);
      if (pkt.kind !== 'paramAck' || pkt.paramId !== PARAM_ACK_PAD_TABLE) return;
      // 레코드가 손을 알면(BLE) 그 손, 아니면 패킷 role, 그것도 손이 아니면 창이 열린 손 전부
      const role = pkt.role === 0 || pkt.role === 1 ? pkt.role : null;
      const known = rec.stickId ?? role;
      const targets = known !== null ? [known] : STICKS.filter((i) => this.hands[i].windowOpen);
      for (const i of targets) {
        const h = this.hands[i];
        if (!h.windowOpen || !h.status) continue;
        this.report(i, { ...h.status, acked: pkt.value });
      }
    });
  }

  private report(i: StickId, st: PadTableStatus | null): void {
    this.hands[i].status = st;
    this.statusCb?.(i, st);
  }

  private clearWindow(h: HandState): void {
    if (h.timer !== null) globalThis.clearTimeout(h.timer);
    h.timer = null;
    h.windowOpen = false;
  }

  private openWindow(i: StickId): void {
    const h = this.hands[i];
    this.clearWindow(h);
    h.windowOpen = true;
    h.timer = globalThis.setTimeout(() => {
      h.timer = null;
      h.windowOpen = false;
    }, ACK_WINDOW_MS);
  }

  /** 연결이 끊기거나 소스가 바뀌면 보낸 표를 잊는다 */
  private forget(i: StickId): void {
    const h = this.hands[i];
    h.lastHash = null;
    this.clearWindow(h);
    if (h.status !== null) this.report(i, null);
  }

  private usable(): InputSource | null {
    const src = this.source;
    return src && src.sendCommand && src.state === 'connected' ? src : null;
  }

  setSource(src: InputSource | null): void {
    this.offState?.();
    this.offState = null;
    this.source = src;
    for (const i of STICKS) this.forget(i);
    if (!src) return;
    this.offState = src.onState((s) => {
      if (s !== 'connected') for (const i of STICKS) this.forget(i);
    });
  }

  /**
   * 프로필의 스틱 패드 앵커를 한 손에 보낸다(ROUTE로 감싸져 패킷당 2개). 그 손에 직전과 같은 표(소수 2자리 기준)면 보내지 않고,
   * force면 같은 표여도 보낸다.
   */
  push(profile: CalibrationProfile, opts: { stickId: StickId; force?: boolean }): void {
    const src = this.usable();
    if (!src) return;
    const entries: PadTableEntry[] = [];
    for (const pad of STICK_PADS) {
      const a = profile.anchors[pad];
      if (a) entries.push({ pad, elevationDeg: a.pitch, azimuthDeg: a.yaw, radiusDeg: a.radius });
    }
    const hash = JSON.stringify(entries.map((e) => [e.pad, round2(e.elevationDeg), round2(e.azimuthDeg), round2(e.radiusDeg)]));
    const i = opts.stickId;
    const h = this.hands[i];
    if (!opts.force && h.lastHash === hash) return;
    h.lastHash = hash;
    // ROUTE로 감싸면 2바이트가 늘어 20바이트 상한이라 패킷당 2개로 보낸다
    for (const bytes of encodeSetPadTable(entries, true, 2)) src.sendCommand!(bytes, i);
    this.openWindow(i);
    this.report(i, { sent: entries.length, acked: null, at: performance.now(), target: i });
  }

  /** 지우기 전용 SET_PAD_TABLE([0x15, 0x80])을 그 손에 보내 표를 비운다(보정 시작, D6). 이후 HIT의 pad는 0xFF가 된다 */
  clear(stickId: StickId): void {
    const src = this.usable();
    if (!src) return;
    const h = this.hands[stickId];
    h.lastHash = null;
    for (const bytes of encodeSetPadTable([], true)) src.sendCommand!(bytes, stickId);
    this.openWindow(stickId);
    this.report(stickId, { sent: 0, acked: null, at: performance.now(), target: stickId });
  }

  /** 테스트용 초기화 */
  reset(): void {
    this.offState?.();
    this.offState = null;
    this.source = null;
    for (const i of STICKS) {
      this.clearWindow(this.hands[i]);
      this.hands[i] = blank();
    }
    this.statusCb = null;
    this.subscribeTap();
  }
}

export const padTableSync = new PadTableSync();
