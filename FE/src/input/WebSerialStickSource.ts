// Web Serial 스틱 소스. 스틱(또는 수신 동글)을 USB로 직결해 921600 8N1로 받는다.
// 프레이밍은 serialFraming(SOF·LEN·CRC8), payload는 stickProtocol 패킷이다. 링크가 하나라 시계 오프셋도 공용이다.
// 사용자 제스처 안에서 connect()를 불러야 포트 선택 창이 열린다.
import type { StickEvent, StickId } from '@/domain/events';
import { BaseInputSource, ClockSync } from './InputSource';
import type { TransportStats } from './InputSource';
import { FrameDecoder, frame } from './serialFraming';
import { packetTap } from './packetTap';
import { encodeHaptic, encodeResetPose, encodeSetMode, encodeSync, parsePacket } from './stickProtocol';
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
  private clock = new ClockSync();
  private pending = new Map<number, number>();
  private syncTimer: number | null = null;
  private connectCount = 0;
  /** 쓰기를 순서대로 직렬화한다 */
  private writeChain: Promise<void> = Promise.resolve();
  /** 사용자가 끊는 중인지(읽기 루프 종료 원인 구분) */
  private closing = false;

  static isSupported(): boolean {
    return getSerial() !== null;
  }

  private sync(): void {
    const t0 = performance.now();
    this.pending.set(Math.floor(t0) >>> 0, t0);
    this.sendCommand(encodeSync(t0));
  }

  private addSyncSample(t0Key: number, t1: number, recvTime: number): void {
    const t0 = this.pending.get(t0Key);
    if (t0 !== undefined) {
      this.pending.delete(t0Key);
      this.clock.addSample(t0, t1, recvTime);
    }
  }

  private emitMapped(e: StickEvent, recvTime: number): void {
    if (e.kind === 'hit' || e.kind === 'pose') {
      this.emit({ ...e, timestamp: this.clock.toBrowserTime(e.timestamp, recvTime) });
    } else {
      this.emit(e);
    }
  }

  private handlePayload(payload: Uint8Array, recvTime: number): void {
    packetTap.publish({ dir: 'in', transport: 'serial', stickId: null, bytes: payload, recvTime });
    const p = parsePacket(payload, recvTime);
    if (!p) return;
    if (p.kind === 'syncAck') this.addSyncSample(p.t0, p.t1, recvTime);
    else this.emitMapped(p, recvTime);
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
    const port = this.port;
    this.port = null;
    try {
      this.writer?.releaseLock();
    } catch {
      // 쓰기 대기 중일 수 있다
    }
    this.writer = null;
    this.reader = null;
    this.pending.clear();
    this.clock.reset();
    this.decoder.reset();
    getSerial()?.removeEventListener('disconnect', this.onPortDisconnect);
    try {
      await port?.close();
    } catch {
      // 이미 분리된 포트
    }
    this.emit({ kind: 'status', stickId: 0, connected: false });
    this.emit({ kind: 'status', stickId: 1, connected: false });
    if (this.state !== 'error') this.setState('disconnected');
  }

  /** 포트를 열고 읽기 루프·동기화를 시작한다. connect와 autoConnect가 같이 쓴다 */
  private async openPort(serial: SerialLike, port: SerialPortLike): Promise<void> {
    await port.open({ baudRate: SERIAL_BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none' });
    if (!port.readable || !port.writable) throw new Error('포트 스트림을 열 수 없습니다');
    this.closing = false;
    this.port = port;
    this.decoder.reset();
    this.clock.reset();
    this.connectCount++;
    const reader = port.readable.getReader();
    this.reader = reader;
    this.writer = port.writable.getWriter();
    serial.addEventListener('disconnect', this.onPortDisconnect);
    this.setState('connected');
    void this.readLoop(reader);
    for (let i = 0; i < 5; i++) setTimeout(() => this.sync(), i * 50);
    this.syncTimer = window.setInterval(() => this.sync(), SYNC_INTERVAL_MS);
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
    this.setState('connecting', '포트 선택 창에서 스틱(또는 동글)을 고르세요. 사용자 클릭 안에서만 열립니다.');
    try {
      const port = await serial.requestPort();
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

  /** payload를 프레이밍해 쓰고, 성공하면 탭에 송신 기록을 남긴다 */
  sendCommand(bytes: Uint8Array): void {
    const writer = this.writer;
    if (!writer) return;
    const payload = new Uint8Array(bytes);
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

  /** 직결은 포트 하나라 stickId를 쓰지 않는다 */
  haptic(_stickId: StickId, strength: number, durationMs: number): void {
    this.sendCommand(encodeHaptic(strength, durationMs));
  }

  /** 포트 하나라 공용 오프셋을 돌려준다 */
  clockOffsetOf(_stickId?: StickId): number | null {
    return this.clock.offset;
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
