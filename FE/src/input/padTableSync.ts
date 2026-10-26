// 패드 테이블 동기화. 캘리브레이션·배치로 만든 프로필의 패드 중심을 스틱에 SET_PAD_TABLE로 보내고,
// PARAM_ACK_PAD_TABLE(적용 후 패드 개수)로 적용을 확인한다. 센서가 연결된 동안만 동작한다.
// input → store 직접 import는 금지라 상태는 onStatus 콜백으로 밖에 알린다(bootstrap이 liveStore에 연결).
import type { CalibrationProfile, PadTableStatus } from '@/domain/calibration';
import { STICK_PADS } from '@/domain/pads';
import type { InputSource } from './InputSource';
import { packetTap } from './packetTap';
import { decodePacket, encodeSetPadTable, PARAM_ACK_PAD_TABLE, type PadTableEntry } from './stickProtocol';

export type { PadTableStatus };

/** 전송 후 PARAM_ACK를 기다리는 시간(ms) */
const ACK_WINDOW_MS = 500;

const round2 = (v: number) => Math.round(v * 100) / 100;

class PadTableSync {
  private source: InputSource | null = null;
  private offState: (() => void) | null = null;
  private offTap: (() => void) | null = null;
  private lastHash: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private windowOpen = false;
  private status: PadTableStatus | null = null;
  private statusCb: ((st: PadTableStatus | null) => void) | null = null;

  constructor() {
    this.subscribeTap();
  }

  /** 상태 보고 콜백 등록(1개). 이후 상태가 바뀔 때마다 호출한다 */
  onStatus(cb: (st: PadTableStatus | null) => void): void {
    this.statusCb = cb;
  }

  private subscribeTap(): void {
    this.offTap?.();
    this.offTap = packetTap.subscribe((rec) => {
      if (rec.dir !== 'in' || !this.windowOpen || !this.status) return;
      const pkt = decodePacket(rec.bytes, rec.recvTime);
      if (pkt.kind !== 'paramAck' || pkt.paramId !== PARAM_ACK_PAD_TABLE) return;
      this.report({ ...this.status, acked: pkt.value });
    });
  }

  private report(st: PadTableStatus | null): void {
    this.status = st;
    this.statusCb?.(st);
  }

  private clearWindow(): void {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    this.windowOpen = false;
  }

  /** 연결이 끊기거나 소스가 바뀌면 보낸 표를 잊는다 */
  private forget(): void {
    this.lastHash = null;
    this.clearWindow();
    if (this.status !== null) this.report(null);
  }

  setSource(src: InputSource | null): void {
    this.offState?.();
    this.offState = null;
    this.source = src;
    this.forget();
    if (!src) return;
    this.offState = src.onState((s) => {
      if (s !== 'connected') this.forget();
    });
  }

  /** 프로필의 스틱 패드 앵커를 스틱에 보낸다. 직전과 같은 표(소수 2자리 기준)면 보내지 않는다 */
  push(profile: CalibrationProfile): void {
    const src = this.source;
    if (!src || !src.sendCommand || src.state !== 'connected') return;
    const entries: PadTableEntry[] = [];
    for (const pad of STICK_PADS) {
      const a = profile.anchors[pad];
      if (a) entries.push({ pad, elevationDeg: a.pitch, azimuthDeg: a.yaw, radiusDeg: a.radius });
    }
    const hash = JSON.stringify(entries.map((e) => [e.pad, round2(e.elevationDeg), round2(e.azimuthDeg), round2(e.radiusDeg)]));
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    for (const bytes of encodeSetPadTable(entries, true)) src.sendCommand(bytes);
    this.clearWindow();
    this.windowOpen = true;
    this.report({ sent: entries.length, acked: null, at: performance.now() });
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      this.windowOpen = false;
    }, ACK_WINDOW_MS);
  }

  /** 테스트용 초기화 */
  reset(): void {
    this.offState?.();
    this.offState = null;
    this.source = null;
    this.lastHash = null;
    this.clearWindow();
    this.status = null;
    this.statusCb = null;
    this.subscribeTap();
  }
}

export const padTableSync = new PadTableSync();
