// WebSocket 스틱 소스. 용도:
//  - 임베디드 파트가 PC에서 센서값을 WebSocket으로 흘려보내는 개발용 브리지(BLE 전에 먼저 맞춰볼 수 있다)
//  - 허브(라즈베리파이) 경유 구조가 확정될 경우의 운영 경로
//  - 폰 IMU(PLAY-11) 브리지
// 메시지는 JSON 한 줄. 바이너리 프레임이 오면 stickProtocol 패킷으로 해석한다.
import type { StickEvent, StickId } from '@/domain/events';
import { BaseInputSource, ClockSync } from './InputSource';
import { parsePacket } from './stickProtocol';
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

  setUrl(url: string): void {
    this.url = url;
  }

  get clockOffset(): number | null {
    return this.clock.offset;
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private sync(): void {
    const t0 = performance.now();
    this.pending.set(Math.floor(t0), t0);
    this.send({ kind: 'sync', t0: Math.floor(t0) });
  }

  private onMessage = (ev: MessageEvent): void => {
    const recvTime = performance.now();
    if (ev.data instanceof ArrayBuffer) {
      const p = parsePacket(new DataView(ev.data), recvTime);
      if (p && p.kind !== 'syncAck') this.emitMapped(p, recvTime);
      return;
    }
    let msg: WsMessage;
    try {
      msg = JSON.parse(ev.data as string) as WsMessage;
    } catch {
      return;
    }
    if (msg.kind === 'sync') {
      const t0 = this.pending.get(msg.t0);
      if (t0 !== undefined) {
        this.pending.delete(msg.t0);
        this.clock.addSample(t0, msg.t1, recvTime);
      }
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
    this.send({ kind: 'setMode', mode: enabled ? 1 : 0 });
  }

  resetPose(): void {
    this.send({ kind: 'resetPose' });
  }

  haptic(stickId: StickId, strength: number, durationMs: number): void {
    this.send({ kind: 'haptic', stickId, strength, durationMs });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('connecting');
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.ws = ws;
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
