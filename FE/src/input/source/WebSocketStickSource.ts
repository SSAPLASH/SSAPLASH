// WebSocket 스틱 소스. 용도:
//  - 임베디드 파트가 PC에서 센서값을 WebSocket으로 흘려보내는 개발용 브리지(BLE 전에 먼저 맞춰볼 수 있다)
//  - 허브(라즈베리파이) 경유 구조가 확정될 경우의 운영 경로
//  - 폰 IMU(PLAY-11) 브리지
// 수신: 바이너리 프레임은 stickProtocol 패킷으로 해석하고, JSON 한 줄 메시지(개발용 브리지)도 받는다.
// 송신: 모두 바이너리 프레임(stickProtocol 인코더).
// 브리지는 스틱 1개당 1개(포트 따로)라서, 주소를 둘 주면 링크 2개(첫째 왼손·둘째 오른손)로 연결한다.
// 둘째 주소가 비면 링크 1개를 두 손이 함께 쓴다(기존 동작).
import type { DeviceRole, StickEvent, StickId } from '@/domain/events';
import { BaseInputSource, ClockSync, SYNC_INTERVAL_MS } from './InputSource';
import { MAX_PENDING_SYNC } from '@/input/deviceState';
import type { TransportStats } from './InputSource';
import { packetTap } from '@/input/packetTap';
import { encodeHaptic, encodeResetPose, encodeSetMode, encodeSync, parsePacket } from '@/input/stickProtocol';
import type { SourceDescriptor } from './SourceDescriptor';

type WsMessage =
  | { kind: 'hit'; stickId: StickId; timestamp: number; peakAccel: number; pitch: number; yaw: number }
  | { kind: 'pose'; stickId: StickId; timestamp: number; pitch: number; yaw: number }
  | { kind: 'status'; stickId: StickId; connected: boolean; batteryPct?: number; firmware?: string }
  | { kind: 'sync'; t0: number; t1: number };

export const DEFAULT_WS_URL = 'ws://localhost:8765';

const HAND_NAME = ['왼손', '오른손'] as const;

/** 브리지 연결 하나. 스틱마다 µs 시계가 달라 시계·SYNC 상태를 링크마다 따로 둔다 */
interface BridgeLink {
  /** 링크가 맡은 손. 링크 1개를 두 손이 공용하면 null */
  hand: StickId | null;
  url: string;
  ws: WebSocket | null;
  clock: ClockSync;
  pending: Map<number, number>;
  syncTimer: ReturnType<typeof setInterval> | null;
  connectCount: number;
  /** 이 링크로 처음 들어온 패킷의 role. 손과 다르면 경고한다 */
  seenRole: StickId | null;
}

export class WebSocketStickSource extends BaseInputSource {
  readonly kind = 'websocket' as const;
  readonly label = 'WebSocket 브리지';
  private links: BridgeLink[] = [];
  /** 기본 주소. 실제 값은 설정(applyOptions → setUrl)으로만 바뀐다 */
  private url = DEFAULT_WS_URL;
  /** 오른손 브리지 주소. 비면 링크 1개 */
  private url2 = '';
  /** 링크 순번별 누적 연결 횟수(connect를 다시 불러도 재연결 수가 이어진다) */
  private connectCounts = [0, 0];

  setUrl(url: string): void {
    this.url = url;
  }

  setUrl2(url: string): void {
    this.url2 = url.trim();
  }

  /** 첫 링크의 오프셋(링크 1개면 공용 오프셋) */
  get clockOffset(): number | null {
    return this.links[0]?.clock.offset ?? null;
  }

  /** 손에 맞는 링크. 손을 안 주면 전부, 링크가 공용(hand null)이면 손과 상관없이 그 링크 */
  private linksFor(stickId?: StickId): BridgeLink[] {
    if (stickId === undefined) return this.links;
    return this.links.filter((l) => l.hand === null || l.hand === stickId);
  }

  /** 바이너리 프레임으로 보내고 탭에 송신 기록을 남긴다 */
  private write(link: BridgeLink, bytes: Uint8Array<ArrayBuffer>): void {
    if (link.ws?.readyState !== WebSocket.OPEN) return;
    link.ws.send(bytes);
    packetTap.publish({ dir: 'out', transport: 'ws', stickId: link.hand, bytes, recvTime: performance.now() });
  }

  private sync(link: BridgeLink): void {
    const t0 = performance.now();
    link.pending.set(Math.floor(t0) >>> 0, t0);
    // 답이 없는 SYNC가 쌓이지 않게 오래된 것부터 버린다
    while (link.pending.size > MAX_PENDING_SYNC) link.pending.delete(link.pending.keys().next().value!);
    this.write(link, encodeSync(t0));
  }

  private addSyncSample(link: BridgeLink, t0Key: number, t1: number, recvTime: number): void {
    const t0 = link.pending.get(t0Key);
    if (t0 !== undefined) {
      link.pending.delete(t0Key);
      link.clock.addSample(t0, t1, recvTime);
    }
  }

  private onMessage(link: BridgeLink, ev: MessageEvent): void {
    const recvTime = performance.now();
    if (ev.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(ev.data);
      packetTap.publish({ dir: 'in', transport: 'ws', stickId: link.hand, bytes, recvTime });
      const p = parsePacket(bytes, recvTime);
      if (!p) return;
      if (p.kind === 'syncAck') this.addSyncSample(link, p.t0, p.t1, recvTime);
      // 페달(role 2·3) 이벤트는 동글 소스만 쓴다
      else if (p.kind === 'pedal' || p.kind === 'pedalStatus' || (p.kind === 'hit' && p.foot !== undefined)) return;
      else this.emitMapped(link, p, recvTime);
      return;
    }
    let msg: WsMessage;
    try {
      msg = JSON.parse(ev.data as string) as WsMessage;
    } catch {
      return;
    }
    if (msg.kind === 'sync') {
      this.addSyncSample(link, msg.t0, msg.t1, recvTime);
      return;
    }
    if (msg.kind === 'hit') {
      this.emitMapped(link, { ...msg, recvTime }, recvTime);
    } else if (msg.kind === 'pose' || msg.kind === 'status') {
      this.emitMapped(link, msg, recvTime);
    }
  }

  /** 링크 손과 다른 role 패킷을 처음 받으면 경고 1회. 이벤트의 손은 패킷 role 그대로 둔다 */
  private checkRole(link: BridgeLink, role: StickId): void {
    if (link.seenRole !== null) return;
    link.seenRole = role;
    if (link.hand !== null && role !== link.hand) {
      this.setState(
        this.state,
        `${HAND_NAME[link.hand]} 브리지(${link.url})에서 ${HAND_NAME[role]} role 패킷이 들어옵니다. 주소 순서를 확인하세요`,
      );
    }
  }

  private emitMapped(link: BridgeLink, e: StickEvent, recvTime: number): void {
    if ('stickId' in e && e.stickId !== null) this.checkRole(link, e.stickId);
    if (e.kind === 'hit' || e.kind === 'pose') {
      this.emit({ ...e, timestamp: link.clock.toBrowserTime(e.timestamp, recvTime) });
    } else {
      this.emit(e);
    }
  }

  setPoseStream(enabled: boolean): void {
    for (const l of this.links) this.write(l, encodeSetMode(enabled ? 1 : 0));
  }

  resetPose(): void {
    for (const l of this.links) this.write(l, encodeResetPose());
  }

  /** 링크가 손별이면 그 손 링크로만, 공용 링크면 그 링크로 보낸다 */
  haptic(stickId: StickId, strength: number, durationMs: number): void {
    for (const l of this.linksFor(stickId)) this.write(l, encodeHaptic(strength, durationMs));
  }

  /** stickId가 있으면 그 손 링크만, 없으면 모든 링크 */
  sendCommand(bytes: Uint8Array, stickId?: StickId): void {
    for (const l of this.linksFor(stickId)) this.write(l, new Uint8Array(bytes));
  }

  /** 그 손 링크의 오프셋. 링크 1개를 공용하면 공용 오프셋 */
  clockOffsetOf(role?: DeviceRole): number | null {
    // 발(role 2·3)은 WebSocket 브리지에 없다
    if (role === 2 || role === 3) return null;
    return this.linksFor(role)[0]?.clock.offset ?? null;
  }

  transportStats(): TransportStats {
    const total = this.links.reduce((n, l) => n + Math.max(0, l.connectCount - 1), 0);
    return { crcErrors: 0, resyncCount: 0, droppedBytes: 0, reconnects: total };
  }

  private anyOpen(): boolean {
    return this.links.some((l) => l.ws !== null);
  }

  private stopLink(link: BridgeLink): void {
    if (link.syncTimer !== null) clearInterval(link.syncTimer);
    link.syncTimer = null;
  }

  /** 링크 하나를 연다. 열리면 resolve, 실패하면 reject */
  private openLink(link: BridgeLink, index: number, single: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(link.url);
      ws.binaryType = 'arraybuffer';
      let opened = false;
      ws.onopen = () => {
        opened = true;
        link.ws = ws;
        this.connectCounts[index]++;
        link.connectCount = this.connectCounts[index];
        link.clock.reset();
        this.setState('connected');
        for (let i = 0; i < 5; i++) setTimeout(() => this.sync(link), i * 50);
        link.syncTimer = setInterval(() => this.sync(link), SYNC_INTERVAL_MS);
        resolve();
      };
      ws.onmessage = (ev) => this.onMessage(link, ev);
      ws.onerror = () => {
        // 링크가 하나뿐이면 곧바로 오류. 둘이면 connect가 결과를 모아 판단한다
        if (single) this.setState('error', `연결 실패: ${link.url}`);
        if (!opened) reject(new Error('ws error'));
      };
      ws.onclose = () => {
        this.stopLink(link);
        if (link.ws === ws) link.ws = null;
        if (link.hand === null) {
          this.emit({ kind: 'status', stickId: 0, connected: false });
          this.emit({ kind: 'status', stickId: 1, connected: false });
        } else {
          this.emit({ kind: 'status', stickId: link.hand, connected: false });
        }
        if (this.anyOpen()) {
          // 한 손 링크만 끊긴 경우: 남은 링크는 유지하고 알림만 남긴다
          if (opened && link.hand !== null) this.setState('connected', `${HAND_NAME[link.hand]} 브리지 연결이 끊어졌습니다`);
        } else if (this.state !== 'error') {
          this.setState('disconnected');
        }
      };
    });
  }

  async connect(): Promise<void> {
    this.teardown();
    this.setState('connecting');
    const two = this.url2 !== '';
    const mk = (hand: StickId | null, url: string): BridgeLink => ({
      hand,
      url,
      ws: null,
      clock: new ClockSync(),
      pending: new Map(),
      syncTimer: null,
      connectCount: 0,
      seenRole: null,
    });
    this.links = two ? [mk(0, this.url), mk(1, this.url2)] : [mk(null, this.url)];
    const results = await Promise.allSettled(this.links.map((l, i) => this.openLink(l, i, !two)));
    if (!two) {
      if (results[0].status === 'rejected') throw results[0].reason;
      return;
    }
    const failed = this.links.filter((_, i) => results[i].status === 'rejected');
    if (failed.length === this.links.length) {
      this.setState('error', `연결 실패: ${this.url}, ${this.url2}`);
      throw new Error('ws error');
    }
    if (failed.length > 0) {
      const msg = failed.map((l) => `${HAND_NAME[l.hand as StickId]} 브리지 연결 실패: ${l.url}`).join(' / ');
      this.setState('connected', msg);
    }
  }

  /** 재연결용. 이미 열려 있으면 무동작, 아니면 connect()를 부르되 던지지 않는다(실패 상태는 connect가 남긴 대로) */
  async autoConnect(): Promise<void> {
    if (this.anyOpen()) return;
    try {
      await this.connect();
    } catch {
      // 상태는 connect가 이미 error로 남겼다
    }
  }

  /** 이전 연결을 이벤트 없이 정리한다(connect를 다시 부를 때) */
  private teardown(): void {
    for (const l of this.links) {
      this.stopLink(l);
      if (l.ws) {
        l.ws.onclose = null;
        l.ws.close();
      }
      l.ws = null;
    }
    this.links = [];
  }

  async disconnect(): Promise<void> {
    for (const l of this.links) {
      this.stopLink(l);
      l.ws?.close();
      l.ws = null;
    }
    this.setState('disconnected');
  }
}

export const webSocketDescriptor: SourceDescriptor = {
  id: 'websocket',
  label: 'WebSocket 브리지',
  description: '임베디드 PC 브리지·허브·폰 IMU에서 받기',
  availability: () => ({ ok: true }),
  create: () => new WebSocketStickSource(),
  options: [
    { key: 'url', label: '브리지 주소 (왼손 또는 1스틱, 바꾸면 입력 방식을 다시 선택)', type: 'text', default: DEFAULT_WS_URL },
    {
      key: 'url2',
      label: '오른손 브리지 주소 (비우면 1개만)',
      type: 'text',
      default: '',
      hint: '브리지는 스틱 1개당 1개(포트 따로). 예: ws://localhost:8766',
    },
  ],
  applyOptions(instance: WebSocketStickSource, o) {
    instance.setUrl(String(o.url));
    instance.setUrl2(String(o.url2 ?? ''));
  },
};
