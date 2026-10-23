// WebSocket 스틱 소스. 용도:
//  - 임베디드 파트가 PC에서 센서값을 WebSocket으로 흘려보내는 개발용 브리지(BLE 전에 먼저 맞춰볼 수 있다)
//  - 허브(라즈베리파이) 경유 구조가 확정될 경우의 운영 경로
//  - 폰 IMU(PLAY-11) 브리지
// 수신: 바이너리 프레임은 stickProtocol 패킷으로 해석하고, JSON 한 줄 메시지(개발용 브리지)도 받는다.
// 송신: 모두 바이너리 프레임(stickProtocol 인코더).
import type { StickEvent, StickId } from '@/domain/events';
import { BaseInputSource, ClockSync } from './InputSource';
import type { TransportStats } from './InputSource';
import { packetTap } from './packetTap';
import { encodeHaptic, encodeResetPose, encodeSetMode, encodeSync, parsePacket } from './stickProtocol';
import type { SourceDescriptor } from './SourceDescriptor';

type WsMessage =
  | { kind: 'hit'; stickId: StickId; timestamp: number; peakAccel: number; pitch: number; yaw: number }
  | { kind: 'pose'; stickId: StickId; timestamp: number; pitch: number; yaw: number }
  | { kind: 'status'; stickId: StickId; connected: boolean; batteryPct?: number; firmware?: string }
  | { kind: 'sync'; t0: number; t1: number };

export const DEFAULT_WS_URL = 'ws://localhost:8765';

export class WebSocketStickSource extends BaseInputSource {
  readonly kind = 'websocket' as const;
  readonly label = 'WebSocket 브리지';
  private ws: WebSocket | null = null;
  /** 기본 주소. 실제 값은 설정(applyOptions → setUrl)으로만 바뀐다 */
  private url = DEFAULT_WS_URL;
  private clock = new ClockSync();
  private pending = new Map<number, number>();
  private syncTimer: number | null = null;
  private connectCount = 0;

  setUrl(url: string): void {
    this.url = url;
  }

  get clockOffset(): number | null {
    return this.clock.offset;
  }

  /** 바이너리 프레임으로 보내고 탭에 송신 기록을 남긴다 */
  private write(bytes: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(bytes);
    packetTap.publish({ dir: 'out', transport: 'ws', stickId: null, bytes, recvTime: performance.now() });
  }

  private sync(): void {
    const t0 = performance.now();
    this.pending.set(Math.floor(t0) >>> 0, t0);
    this.write(encodeSync(t0));
  }

  private addSyncSample(t0Key: number, t1: number, recvTime: number): void {
    const t0 = this.pending.get(t0Key);
    if (t0 !== undefined) {
      this.pending.delete(t0Key);
      this.clock.addSample(t0, t1, recvTime);
    }
  }

  private onMessage = (ev: MessageEvent): void => {
    const recvTime = performance.now();
    if (ev.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(ev.data);
      packetTap.publish({ dir: 'in', transport: 'ws', stickId: null, bytes, recvTime });
      const p = parsePacket(bytes, recvTime);
      if (!p) return;
      if (p.kind === 'syncAck') this.addSyncSample(p.t0, p.t1, recvTime);
      else this.emitMapped(p, recvTime);
      return;
    }
    let msg: WsMessage;
    try {
      msg = JSON.parse(ev.data as string) as WsMessage;
    } catch {
      return;
    }
    if (msg.kind === 'sync') {
      this.addSyncSample(msg.t0, msg.t1, recvTime);
      return;
    }
    if (msg.kind === 'hit') {
      this.emitMapped({ ...msg, recvTime }, recvTime);
    } else if (msg.kind === 'pose' || msg.kind === 'status') {
      this.emitMapped(msg, recvTime);
    }
  };

  private emitMapped(e: StickEvent, recvTime: number): void {
    if (e.kind === 'hit' || e.kind === 'pose') {
      this.emit({ ...e, timestamp: this.clock.toBrowserTime(e.timestamp, recvTime) });
    } else {
      this.emit(e);
    }
  }

  setPoseStream(enabled: boolean): void {
    this.write(encodeSetMode(enabled ? 1 : 0));
  }

  resetPose(): void {
    this.write(encodeResetPose());
  }

  /** 브리지는 어느 손인지 모르므로 stickId는 쓰지 않는다 */
  haptic(_stickId: StickId, strength: number, durationMs: number): void {
    this.write(encodeHaptic(strength, durationMs));
  }

  sendCommand(bytes: Uint8Array): void {
    this.write(new Uint8Array(bytes));
  }

  /** 브리지는 손을 구분하지 않아 공용 오프셋을 돌려준다 */
  clockOffsetOf(_stickId?: StickId): number | null {
    return this.clock.offset;
  }

  transportStats(): TransportStats {
    return { crcErrors: 0, resyncCount: 0, droppedBytes: 0, reconnects: Math.max(0, this.connectCount - 1) };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('connecting');
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.ws = ws;
        this.connectCount++;
        this.clock.reset();
        this.setState('connected');
        for (let i = 0; i < 5; i++) setTimeout(() => this.sync(), i * 50);
        this.syncTimer = window.setInterval(() => this.sync(), 10_000);
        resolve();
      };
      ws.onmessage = this.onMessage;
      ws.onerror = () => {
        this.setState('error', `연결 실패: ${this.url}`);
        reject(new Error('ws error'));
      };
      ws.onclose = () => {
        if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
        this.syncTimer = null;
        this.ws = null;
        this.emit({ kind: 'status', stickId: 0, connected: false });
        this.emit({ kind: 'status', stickId: 1, connected: false });
        if (this.state !== 'error') this.setState('disconnected');
      };
    });
  }

  async disconnect(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }
}

export const webSocketDescriptor: SourceDescriptor = {
  id: 'websocket',
  label: 'WebSocket 브리지',
  description: '임베디드 PC 브리지·허브·폰 IMU에서 받기',
  availability: () => ({ ok: true }),
  create: () => new WebSocketStickSource(),
  options: [{ key: 'url', label: '브리지 주소 (바꾸면 입력 방식을 다시 선택)', type: 'text', default: DEFAULT_WS_URL }],
  applyOptions(instance: WebSocketStickSource, o) {
    instance.setUrl(String(o.url));
  },
};
