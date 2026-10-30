// Web Serial 스틱 소스. 스틱(또는 수신 동글)을 USB로 직결해 921600 8N1로 받는다.
// 프레이밍은 serialFraming(SOF·LEN·CRC8), payload는 stickProtocol 패킷이다.
// 동글 하나에 두 스틱이 붙으면 포트는 하나지만 스틱마다 시계가 달라, 시계 동기화는 손별로 한다(flags role).
// 한 손에만 보낼 명령은 동글이 확인된 뒤(LINK 수신)부터 ROUTE로 감싼다 — 예전 동글·스틱 직결은 ROUTE를 모른다.
// 손별 연결은 LINK 마스크가 기준이다(1초 하트비트 + 바뀔 때). LINK를 한 번 받은 뒤엔 STATUS는 배터리만 바꾼다.
// 첫 LINK 전(예전 동글 펌웨어)에는 지금처럼 STATUS가 오면 연결로 본다.
// 사용자 제스처 안에서 connect()를 불러야 포트 선택 창이 열린다.
import type { DongleLink, StickEvent, StickId } from '@/domain/events';
import { BaseInputSource, ClockSync } from './InputSource';
import type { TransportStats } from './InputSource';
import { FrameDecoder, frame } from './serialFraming';
import { packetTap } from './packetTap';
import {
  decodePacket,
  encodeHaptic,
  encodeResetPose,
  encodeRoute,
  encodeSetMode,
  encodeSync,
  PacketType,
  parsePacket,
} from './stickProtocol';
import type { SourceDescriptor } from './SourceDescriptor';

// @types/w3c-web-serial이 없어 쓰는 멤버만 최소 선언한다
interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd' }): Promise<void>;
  close(): Promise<void>;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  /** 사용자가 이미 허락한 포트 목록 */
  getPorts(): Promise<SerialPortLike[]>;
  addEventListener(type: 'disconnect', listener: (ev: Event) => void): void;
  removeEventListener(type: 'disconnect', listener: (ev: Event) => void): void;
}

export const SERIAL_BAUD_RATE = 921600;
const SYNC_INTERVAL_MS = 10_000;
/** 손별 SYNC 대기 목록 최대 크기 */
const MAX_PENDING_SYNC = 16;
/** LINK가 이 시간(ms) 넘게 안 오면 동글 문제로 본다(EMB 회신 Q3: 하트비트 1초) */
export const LINK_STALE_MS = 3000;

function getSerial(): SerialLike | null {
  return 'serial' in navigator ? (navigator as unknown as { serial: SerialLike }).serial : null;
}

export class WebSerialStickSource extends BaseInputSource {
  readonly kind = 'webserial' as const;
  readonly label = 'Web Serial (USB 직결)';
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private decoder = new FrameDecoder();
  /** 손별 시계·SYNC 대기 목록 (index = StickId) */
  private clocks: [ClockSync, ClockSync] = [new ClockSync(), new ClockSync()];
  private pending: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  /** LINK를 받아 동글 아래 연결임이 확인됐는지. 확인돼야 ROUTE를 쓰고 LINK로 연결을 판정한다 */
  private dongle = false;
  /** 마지막 LINK 마스크의 손별 연결 */
  private linked: [boolean, boolean] = [false, false];
  /** LINK 끊김 중 받은 STATUS 배터리. 그 손이 붙으면 함께 알린다 */
  private heldBattery: [number | undefined, number | undefined] = [undefined, undefined];
  private lastLinkAt: number | null = null;
  private linkTimer: number | null = null;
  private dongleState: DongleLink | null = null;
  private dongleListeners = new Set<(link: DongleLink | null) => void>();
  private syncTimer: number | null = null;
  private connectCount = 0;
  /** 쓰기를 순서대로 직렬화한다 */
  private writeChain: Promise<void> = Promise.resolve();
  /** 사용자가 끊는 중인지(읽기 루프 종료 원인 구분) */
  private closing = false;

  static isSupported(): boolean {
    return getSerial() !== null;
  }

  /** SYNC는 감싸지 않고 보내 두 스틱이 각자 답하게 한다. 대기 목록은 손마다 둔다 */
  private sync(): void {
    const t0 = performance.now();
    const key = Math.floor(t0) >>> 0;
    for (const p of this.pending) {
      p.set(key, t0);
      // 한 손만 붙어 있으면 다른 손 목록은 답이 없어 쌓이므로 오래된 것부터 버린다
      if (p.size > MAX_PENDING_SYNC) p.delete(p.keys().next().value!);
    }
    this.sendCommand(encodeSync(t0));
  }

  private addSyncSample(stickId: StickId, t0Key: number, t1: number, recvTime: number): void {
    const pending = this.pending[stickId];
    const t0 = pending.get(t0Key);
    if (t0 !== undefined) {
      pending.delete(t0Key);
      this.clocks[stickId].addSample(t0, t1, recvTime);
    }
  }

  private resetClocks(): void {
    for (const c of this.clocks) c.reset();
    for (const p of this.pending) p.clear();
  }

  private emitMapped(e: StickEvent, recvTime: number): void {
    if (e.kind === 'hit' || e.kind === 'pose') {
      this.emit({ ...e, timestamp: this.clocks[e.stickId].toBrowserTime(e.timestamp, recvTime) });
    } else {
      this.emit(e);
    }
  }

  onDongle(listener: (link: DongleLink | null) => void): () => void {
    this.dongleListeners.add(listener);
    return () => this.dongleListeners.delete(listener);
  }

  private setDongle(link: DongleLink | null): void {
    if (link === this.dongleState) return;
    this.dongleState = link;
    for (const l of this.dongleListeners) l(link);
  }

  /** 손별 연결을 바꾸고 바뀐 손만 알린다. force면 같아도 알린다(첫 LINK·동글 복구) */
  private applyLinked(next: [boolean, boolean], force: boolean): void {
    for (const id of [0, 1] as const) {
      if (!force && next[id] === this.linked[id]) continue;
      this.linked[id] = next[id];
      const batteryPct = next[id] ? this.heldBattery[id] : undefined;
      if (next[id]) this.heldBattery[id] = undefined;
      this.emit({ kind: 'status', stickId: id, connected: next[id], batteryPct });
    }
  }

  private handleLink(payload: Uint8Array, recvTime: number): void {
    const d = decodePacket(payload, recvTime);
    if (d.kind !== 'link') return;
    const first = !this.dongle || this.dongleState === 'stale';
    this.dongle = true;
    this.lastLinkAt = recvTime;
    this.setDongle('ok');
    this.applyLinked([(d.linkMask & 0b01) !== 0, (d.linkMask & 0b10) !== 0], first);
  }

  /** LINK 하트비트가 끊겼는지 본다. 끊겼으면 동글 문제로 두고 양손을 끊김으로 둔다(어느 손이 붙었는지 모름) */
  checkLinkTimeout(now: number = performance.now()): void {
    if (!this.dongle || this.lastLinkAt === null || this.dongleState === 'stale') return;
    if (now - this.lastLinkAt <= LINK_STALE_MS) return;
    this.setDongle('stale');
    this.applyLinked([false, false], false);
  }

  private handlePayload(payload: Uint8Array, recvTime: number): void {
    packetTap.publish({ dir: 'in', transport: 'serial', stickId: null, bytes: payload, recvTime });
    if (payload[0] === PacketType.LINK) {
      this.handleLink(payload, recvTime);
      return;
    }
    const p = parsePacket(payload, recvTime);
    if (!p) return;
    if (p.kind === 'syncAck') this.addSyncSample(p.stickId, p.t0, p.t1, recvTime);
    else if (p.kind === 'status' && this.dongle) this.handleStatusUnderDongle(p.stickId, p.batteryPct);
    else this.emitMapped(p, recvTime);
  }

  /** 동글 아래 STATUS는 배터리만 쓴다. 연결은 LINK가 정하고, 아직 안 붙은 손이면 배터리를 들고 있다가 붙을 때 알린다 */
  private handleStatusUnderDongle(stickId: StickId, batteryPct: number | undefined): void {
    if (this.linked[stickId]) this.emit({ kind: 'status', stickId, connected: true, batteryPct });
    else this.heldBattery[stickId] = batteryPct;
  }

  /** 읽기 루프. 스트림이 끝나거나 오류가 나면 끊김 처리한다 */
  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const recvTime = performance.now();
        for (const payload of this.decoder.push(value)) this.handlePayload(payload, recvTime);
      }
    } catch {
      // 케이블 분리 등 읽기 오류는 아래 정리로 처리
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // 이미 해제됨
      }
      if (!this.closing) await this.cleanup();
    }
  }

  private onPortDisconnect = (ev: Event): void => {
    if (ev.target === this.port && !this.closing) void this.cleanup();
  };

  /** 포트·타이머·상태 정리. 끊김 상태로 되돌린다 */
  private async cleanup(): Promise<void> {
    if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
    this.syncTimer = null;
    if (this.linkTimer !== null) window.clearInterval(this.linkTimer);
    this.linkTimer = null;
    const port = this.port;
    this.port = null;
    try {
      this.writer?.releaseLock();
    } catch {
      // 쓰기 대기 중일 수 있다
    }
    this.writer = null;
    this.reader = null;
    this.resetClocks();
    this.resetLink();
    this.decoder.reset();
    getSerial()?.removeEventListener('disconnect', this.onPortDisconnect);
    try {
      await port?.close();
    } catch {
      // 이미 분리된 포트
    }
    this.emit({ kind: 'status', stickId: 0, connected: false });
    this.emit({ kind: 'status', stickId: 1, connected: false });
    this.setDongle(null);
    if (this.state !== 'error') this.setState('disconnected');
  }

  /** 포트를 열고 읽기 루프·동기화를 시작한다. connect와 autoConnect가 같이 쓴다 */
  private async openPort(serial: SerialLike, port: SerialPortLike): Promise<void> {
    await port.open({ baudRate: SERIAL_BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none' });
    if (!port.readable || !port.writable) throw new Error('포트 스트림을 열 수 없습니다');
    this.closing = false;
    this.port = port;
    this.decoder.reset();
    this.resetClocks();
    this.resetLink();
    this.connectCount++;
    const reader = port.readable.getReader();
    this.reader = reader;
    this.writer = port.writable.getWriter();
    serial.addEventListener('disconnect', this.onPortDisconnect);
    this.setState('connected');
    void this.readLoop(reader);
    for (let i = 0; i < 5; i++) setTimeout(() => this.sync(), i * 50);
    this.syncTimer = window.setInterval(() => this.sync(), SYNC_INTERVAL_MS);
    this.linkTimer = window.setInterval(() => this.checkLinkTimeout(), 1000);
    this.setDongle('waiting');
  }

  private resetLink(): void {
    this.dongle = false;
    this.linked = [false, false];
    this.heldBattery = [undefined, undefined];
    this.lastLinkAt = null;
  }

  /**
   * 이미 허락받은 포트가 있으면 클릭 없이 연다(페이지 로드 시). 허락한 포트가 없거나 열기에 실패하면
   * 조용히 끊김으로 둔다 — 그때는 사용자가 connect()(포트 선택 버튼)로 연다.
   */
  async autoConnect(): Promise<void> {
    const serial = getSerial();
    if (!serial) return;
    try {
      const [port] = await serial.getPorts();
      if (!port) {
        this.setState('disconnected');
        return;
      }
      this.setState('connecting');
      await this.openPort(serial, port);
    } catch {
      await this.cleanup();
      this.setState('disconnected');
    }
  }

  async connect(): Promise<void> {
    const serial = getSerial();
    if (!serial) {
      this.setState('error', '이 브라우저는 Web Serial을 지원하지 않습니다(Chrome/Edge)');
      throw new Error('web serial unsupported');
    }
    // 이미 열린 포트가 있으면(다른 동글 연결) 새 포트를 고른 뒤에만 닫는다 — 선택을 취소하면 그대로 둔다
    const wasOpen = this.port !== null;
    this.setState('connecting', '포트 선택 창에서 스틱(또는 동글)을 고르세요. 사용자 클릭 안에서만 열립니다.');
    let port: SerialPortLike;
    try {
      port = await serial.requestPort();
    } catch (e) {
      if (wasOpen && this.port) {
        this.setState('connected');
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.setState('error', `Web Serial 연결 실패: ${msg}`);
      throw e;
    }
    try {
      if (this.port) await this.disconnect();
      this.setState('connecting');
      await this.openPort(serial, port);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setState('error', `Web Serial 연결 실패: ${msg}`);
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      // 이미 닫힘
    }
    await this.cleanup();
    this.closing = false;
  }

  /**
   * payload를 프레이밍해 쓰고, 성공하면 탭에 송신 기록을 남긴다.
   * stickId가 있고 동글이 확인됐으면 ROUTE로 감싸 그 손에만 보낸다. 없으면 붙은 스틱 모두에 간다.
   */
  sendCommand(bytes: Uint8Array, stickId?: StickId): void {
    const writer = this.writer;
    if (!writer) return;
    const payload = stickId !== undefined && this.dongle ? encodeRoute(stickId, bytes) : new Uint8Array(bytes);
    let framed: Uint8Array;
    try {
      framed = frame(payload);
    } catch {
      return; // 길이가 맞지 않는 명령은 보내지 않는다
    }
    this.writeChain = this.writeChain
      .then(() => writer.write(framed))
      .then(() => {
        packetTap.publish({ dir: 'out', transport: 'serial', stickId: null, bytes: payload, recvTime: performance.now() });
      })
      .catch(() => {
        // 쓰기 실패(분리 등)는 읽기 루프·disconnect 이벤트가 정리한다
      });
  }

  setPoseStream(enabled: boolean): void {
    this.sendCommand(encodeSetMode(enabled ? 1 : 0));
  }

  resetPose(): void {
    this.sendCommand(encodeResetPose());
  }

  haptic(stickId: StickId, strength: number, durationMs: number): void {
    this.sendCommand(encodeHaptic(strength, durationMs), stickId);
  }

  /** 손을 안 주면 먼저 맞춰진 쪽(왼손 우선)을 돌려준다 */
  clockOffsetOf(stickId?: StickId): number | null {
    if (stickId !== undefined) return this.clocks[stickId].offset;
    return this.clocks[0].offset ?? this.clocks[1].offset;
  }

  transportStats(): TransportStats {
    return { ...this.decoder.stats(), reconnects: Math.max(0, this.connectCount - 1) };
  }
}

export const webSerialDescriptor: SourceDescriptor = {
  id: 'webserial',
  label: 'Web Serial (USB 직결)',
  description: 'USB 케이블로 스틱·동글을 직접 연결 (921600 8N1)',
  availability: () => ('serial' in navigator ? { ok: true } : { ok: false, reason: 'Chrome/Edge에서만 쓸 수 있습니다.' }),
  create: () => new WebSerialStickSource(),
  note: '입력 방식을 선택하면 포트 선택 창이 열립니다. 직결 CRC 통계는 모니터에서 볼 수 있습니다.',
};
