// Web Serial 스틱 소스. 스틱(또는 수신 동글)을 USB로 직결해 921600 8N1로 받는다.
// 프레이밍은 serialFraming(SOF·LEN·CRC8), payload는 stickProtocol 패킷이다.
// 기기별 상태(deviceState)는 role 0~3 네 칸이다: 시계·SYNC 대기·연결·배터리/설정 전 보류를 칸마다 두고,
// 이벤트는 손(role 0·1)은 status·hit·pose, 발(role 2·3)은 pedalStatus·hit(foot)·pedal이다(handOf·footOf). 동글 하나에 두 스틱이 붙어도 스틱마다 시계가 달라 손별로 맞춘다.
// 한 손에만 보낼 명령은 동글이 확인된 뒤(LINK 수신)부터 ROUTE로 감싼다 — 예전 동글·스틱 직결은 ROUTE를 모른다.
// 손별 연결은 LINK 마스크가 기준이다(1초 하트비트 + 바뀔 때). LINK를 한 번 받은 뒤엔 STATUS는 배터리·설정 전만 바꾼다.
// 동글 순서상 STATUS(비트 5 설정 전)가 LINK보다 먼저 올 수 있어, 안 붙은 손의 배터리·비트 5는 보류했다가 붙을 때 함께 알린다.
// 시계 초기화(D6): LINK 0→1 또는 STATUS 비트 5를 받은 기기는 시계·대기를 지우고 SYNC를 50ms 간격 5회 보낸다
// (2초 안의 두 번째 신호는 건너뜀). 포트를 열 때도 전체 초기화 + SYNC 5회.
// reopen()은 연결이 살아 있어도 같은 포트를 닫고 다시 연다(재연결 시도). navigator.serial의 connect 이벤트
// (허락된 동글을 다시 꽂음)가 오면 포트가 닫혀 있을 때 autoConnect()로 클릭 없이 다시 연다.
// 첫 LINK 전(예전 동글 펌웨어)에는 지금처럼 STATUS가 오면 연결로 본다.
// 사용자 제스처 안에서 connect()를 불러야 포트 선택 창이 열린다.
import type { DongleLink, FootId, StickEvent, StickId } from '@/domain/events';
import { BaseInputSource, SYNC_INTERVAL_MS } from './InputSource';
import type { TransportStats } from './InputSource';
import { FrameDecoder, frame } from '@/input/serialFraming';
import { packetTap } from '@/input/packetTap';
import { addPending, createDeviceStates, resetClockIfDue, resetDevice } from '@/input/deviceState';
import type { DeviceRole } from '@/input/deviceState';
import {
  decodePacket,
  encodeHaptic,
  encodeResetPose,
  encodeRoute,
  encodeSetMode,
  encodeSync,
  handOf,
  PacketType,
  parsePacket,
} from '@/input/stickProtocol';
import type { DecodedStatus } from '@/input/stickProtocol';
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
  addEventListener(type: 'disconnect' | 'connect', listener: (ev: Event) => void): void;
  removeEventListener(type: 'disconnect' | 'connect', listener: (ev: Event) => void): void;
}

export const SERIAL_BAUD_RATE = 921600;
/** 시계 초기화 뒤 SYNC 연속 송신 횟수·간격 */
const SYNC_BURST_COUNT = 5;
const SYNC_BURST_GAP_MS = 50;
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
  /** 기기별 시계·SYNC 대기·연결·보류 상태 (index = role 0~3) */
  private devices = createDeviceStates();
  /** serial connect 이벤트 리스너를 등록했는지(인스턴스당 1회) */
  private connectListening = false;
  /** LINK를 받아 동글 아래 연결임이 확인됐는지. 확인돼야 ROUTE를 쓰고 LINK로 연결을 판정한다 */
  private dongle = false;
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

  /** SYNC는 감싸지 않고 보내 붙은 스틱이 각자 답하게 한다. 대기 목록은 네 칸 모두에 넣는다 */
  private sync(): void {
    const t0 = performance.now();
    const key = Math.floor(t0) >>> 0;
    // 답이 없는 기기의 목록은 addPending이 오래된 것부터 버린다
    for (const dev of this.devices) addPending(dev, key, t0);
    this.sendCommand(encodeSync(t0));
  }

  /** SYNC를 50ms 간격으로 5회 예약한다 */
  private scheduleSyncBurst(): void {
    for (let i = 0; i < SYNC_BURST_COUNT; i++) setTimeout(() => this.sync(), i * SYNC_BURST_GAP_MS);
  }

  /** 시계 초기화 트리거(LINK 0→1·비트 5). 2초 안 중복이 아니면 초기화하고 SYNC 5회를 예약한다 */
  private restartClock(role: DeviceRole, now: number): void {
    if (resetClockIfDue(this.devices[role], now)) this.scheduleSyncBurst();
  }

  private addSyncSample(role: DeviceRole, t0Key: number, t1: number, recvTime: number): void {
    const dev = this.devices[role];
    const t0 = dev.pending.get(t0Key);
    if (t0 !== undefined) {
      dev.pending.delete(t0Key);
      dev.clock.addSample(t0, t1, recvTime);
    }
  }

  private resetDevices(): void {
    for (const dev of this.devices) resetDevice(dev);
  }

  private emitMapped(e: StickEvent, recvTime: number): void {
    if (e.kind === 'pedal') {
      // 하이햇 페달(role 2)의 보드 시각을 그 칸 시계로 브라우저 시각으로 환산한다
      this.emit({ ...e, timestamp: this.devices[e.foot].clock.toBrowserTime(e.timestamp, recvTime) });
    } else if (e.kind === 'hit' || e.kind === 'pose') {
      // 발 타격(stickId null)은 foot 칸의 시계로 환산한다
      const role = e.kind === 'hit' ? (e.foot ?? e.stickId) : e.stickId;
      if (role === null) return;
      this.emit({ ...e, timestamp: this.devices[role].clock.toBrowserTime(e.timestamp, recvTime) });
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

  /** 칸별 연결을 바꾸고 바뀐 칸만 알린다(손은 status, 발은 pedalStatus). force면 같아도 알린다(첫 LINK·동글 복구). 붙는 칸은 보류한 배터리·설정 전을 함께 알린다 */
  private applyLinked(next: [boolean, boolean, boolean, boolean], force: boolean, recvTime: number): void {
    for (const role of [0, 1, 2, 3] as const) {
      const dev = this.devices[role];
      if (!force && next[role] === dev.linked) continue;
      const wasLinked = dev.linked;
      dev.linked = next[role];
      if (next[role]) {
        const batteryPct = dev.heldBattery;
        const unconfigured = dev.heldUnconfigured;
        dev.heldBattery = undefined;
        dev.heldUnconfigured = false;
        if (role < 2) this.emit({ kind: 'status', stickId: role as StickId, connected: true, batteryPct, unconfigured });
        else this.emit({ kind: 'pedalStatus', foot: role as FootId, connected: true, batteryPct });
        if (!wasLinked) this.restartClock(role, recvTime);
      } else {
        if (wasLinked) {
          dev.heldBattery = undefined;
          dev.heldUnconfigured = false;
        }
        this.emitDisconnected(role);
      }
    }
  }

  /** 그 칸의 끊김을 알린다(손은 status, 발은 pedalStatus) */
  private emitDisconnected(role: DeviceRole): void {
    if (role < 2) this.emit({ kind: 'status', stickId: role as StickId, connected: false });
    else this.emit({ kind: 'pedalStatus', foot: role as FootId, connected: false });
  }

  private handleLink(payload: Uint8Array, recvTime: number): void {
    const d = decodePacket(payload, recvTime);
    if (d.kind !== 'link') return;
    const first = !this.dongle || this.dongleState === 'stale';
    this.dongle = true;
    this.lastLinkAt = recvTime;
    this.setDongle('ok');
    this.applyLinked(
      [(d.linkMask & 0b0001) !== 0, (d.linkMask & 0b0010) !== 0, (d.linkMask & 0b0100) !== 0, (d.linkMask & 0b1000) !== 0],
      first,
      recvTime,
    );
  }

  /** LINK 하트비트가 끊겼는지 본다. 끊겼으면 동글 문제로 두고 네 칸(양손·두 발)을 끊김으로 둔다(어느 칸이 붙었는지 모름) */
  checkLinkTimeout(now: number = performance.now()): void {
    if (!this.dongle || this.lastLinkAt === null || this.dongleState === 'stale') return;
    if (now - this.lastLinkAt <= LINK_STALE_MS) return;
    this.setDongle('stale');
    this.applyLinked([false, false, false, false], false, now);
  }

  private handlePayload(payload: Uint8Array, recvTime: number): void {
    packetTap.publish({ dir: 'in', transport: 'serial', stickId: null, bytes: payload, recvTime });
    if (payload[0] === PacketType.LINK) {
      this.handleLink(payload, recvTime);
      return;
    }
    const d = decodePacket(payload, recvTime);
    // 기기 칸은 role 0~3 모두 갱신하고, 이벤트는 손은 status·hit·pose, 발은 pedalStatus·hit(foot)·pedal로 낸다
    if (d.kind === 'syncAck') {
      this.addSyncSample((d.role & 3) as DeviceRole, d.t0Ms, d.t1Us / 1000, recvTime);
      return;
    }
    if (d.kind === 'status') {
      this.handleStatus(d, payload, recvTime);
      return;
    }
    const p = parsePacket(payload, recvTime);
    if (p && p.kind !== 'syncAck') this.emitMapped(p, recvTime);
  }

  /**
   * STATUS. 비트 5(설정 전)면 그 기기의 시계를 초기화한다. 동글 아래에선 연결을 LINK가 정하므로 아직 안 붙은 손은
   * 배터리·설정 전을 보류하고(붙을 때 알림), 붙은 손은 바로 알린다. 동글이 아니면 STATUS가 곧 연결이다.
   */
  private handleStatus(d: DecodedStatus, payload: Uint8Array, recvTime: number): void {
    const role = (d.role & 3) as DeviceRole;
    const dev = this.devices[role];
    if (d.unconfigured) this.restartClock(role, recvTime);
    if (this.dongle) {
      const batteryPct = d.batteryPct ?? undefined;
      if (dev.linked) {
        const stickId = handOf(role);
        if (stickId !== null) this.emit({ kind: 'status', stickId, connected: true, batteryPct, unconfigured: d.unconfigured });
        // 발은 설정 전(비트 5)을 싣지 않는다 — 시계 초기화만 하고 설정 재전송은 없다
        else this.emit({ kind: 'pedalStatus', foot: role as FootId, connected: true, batteryPct });
      } else {
        dev.heldBattery = batteryPct;
        dev.heldUnconfigured = d.unconfigured;
      }
      return;
    }
    const p = parsePacket(payload, recvTime);
    if (p && p.kind !== 'syncAck') this.emitMapped(p, recvTime);
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
      // reopen 중 옛 읽기 루프가 새 연결을 정리하지 않도록 지금 읽기 루프일 때만 정리한다
      if (!this.closing && this.reader === reader) await this.cleanup();
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
    this.resetDevices();
    this.resetLink();
    this.decoder.reset();
    getSerial()?.removeEventListener('disconnect', this.onPortDisconnect);
    try {
      await port?.close();
    } catch {
      // 이미 분리된 포트
    }
    for (const role of [0, 1, 2, 3] as const) this.emitDisconnected(role);
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
    this.resetDevices();
    this.resetLink();
    this.connectCount++;
    const reader = port.readable.getReader();
    this.reader = reader;
    this.writer = port.writable.getWriter();
    serial.addEventListener('disconnect', this.onPortDisconnect);
    this.setState('connected');
    void this.readLoop(reader);
    this.scheduleSyncBurst();
    this.syncTimer = window.setInterval(() => this.sync(), SYNC_INTERVAL_MS);
    this.linkTimer = window.setInterval(() => this.checkLinkTimeout(), 1000);
    this.setDongle('waiting');
  }

  private resetLink(): void {
    this.dongle = false;
    this.lastLinkAt = null;
  }

  /**
   * 이미 허락받은 포트가 있으면 클릭 없이 연다(페이지 로드 시). 허락한 포트가 없거나 열기에 실패하면
   * 조용히 끊김으로 둔다 — 그때는 사용자가 connect()(포트 선택 버튼)로 연다.
   */
  async autoConnect(): Promise<void> {
    const serial = getSerial();
    if (!serial) return;
    this.listenConnect(serial);
    // 이미 열려 있거나 여는 중이면 아무것도 안 한다(같은 포트를 두 번 열면 InvalidStateError로 살아 있는 연결이 끊긴다)
    if (this.port !== null || this.state === 'connecting') return;
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

  /** 허락된 동글을 다시 꽂으면(serial connect) 포트가 닫혀 있을 때만 클릭 없이 다시 연다. 인스턴스당 1회 등록 */
  private listenConnect(serial: SerialLike): void {
    if (this.connectListening) return;
    this.connectListening = true;
    serial.addEventListener('connect', () => {
      if (this.port === null && this.state !== 'connecting') void this.autoConnect();
    });
  }

  /**
   * 연결이 살아 있어도 같은 포트를 닫고 다시 연다(재연결 시도). 양손 끊김을 알린 뒤 다시 열어 SYNC 5회를 보내고
   * LINK를 기다린다. 포트가 안 열려 있으면 autoConnect와 같다. 실패해도 던지지 않고 끊김으로 둔다.
   */
  async reopen(): Promise<void> {
    const serial = getSerial();
    if (!serial) return;
    // 여는 중(다른 시도의 reopen·autoConnect)이면 겹치지 않게 돌아간다
    if (this.state === 'connecting') return;
    // disconnect가 포트 참조를 비우므로 먼저 잡아 둔다
    const port = this.port;
    if (!port) {
      await this.autoConnect();
      return;
    }
    // disconnect가 읽기 취소 → cleanup(port.close 대기)까지 마친 뒤에 열어야 "already open"이 안 난다
    await this.disconnect();
    try {
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
    this.listenConnect(serial);
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

  /** role을 안 주면 먼저 맞춰진 손(왼손 우선)을 돌려준다. 발(2·3)은 그 칸 시계 */
  clockOffsetOf(role?: DeviceRole): number | null {
    if (role !== undefined) return this.devices[role].clock.offset;
    return this.devices[0].clock.offset ?? this.devices[1].clock.offset;
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
