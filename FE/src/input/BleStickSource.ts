// PLAY-01 Web Bluetooth 스틱 연결. 스틱 하나 = BLE 주변기기 하나. 두 개를 각각 연결한다.
// 하드웨어가 없는 동안은 미검증 — 프로토콜(stickProtocol.ts)과 흐름만 맞춰 둔다.
import type { StickId } from '@/domain/events';
import { BaseInputSource, ClockSync } from './InputSource';
import type { TransportStats } from './InputSource';
import { packetTap } from './packetTap';
import type { SourceDescriptor } from './SourceDescriptor';
import {
  STICK_CONTROL_UUID,
  STICK_NOTIFY_UUID,
  STICK_SERVICE_UUID,
  StreamMode,
  encodeHaptic,
  encodeResetPose,
  encodeSetMode,
  encodeSync,
  parsePacket,
} from './stickProtocol';

interface StickLink {
  stickId: StickId;
  device: BluetoothDevice;
  notify: BluetoothRemoteGATTCharacteristic;
  control: BluetoothRemoteGATTCharacteristic;
  clock: ClockSync;
  pendingSync: Map<number, number>; // t0(u32) → performance.now()
}

export class BleStickSource extends BaseInputSource {
  readonly kind = 'ble' as const;
  readonly label = 'BLE 스틱';
  private links = new Map<StickId, StickLink>();
  private syncTimer: number | null = null;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /** 스틱 하나를 고른다. 반드시 클릭 등 사용자 제스처 안에서 호출 */
  async pair(stickId: StickId): Promise<void> {
    if (!BleStickSource.isSupported()) {
      this.setState('error', '이 브라우저는 Web Bluetooth를 지원하지 않습니다. Chrome/Edge를 쓰세요.');
      throw new Error('Web Bluetooth unsupported');
    }
    this.setState('connecting');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [STICK_SERVICE_UUID] }],
      optionalServices: [STICK_SERVICE_UUID],
    });
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(STICK_SERVICE_UUID);
    const notify = await service.getCharacteristic(STICK_NOTIFY_UUID);
    const control = await service.getCharacteristic(STICK_CONTROL_UUID);
    const link: StickLink = { stickId, device, notify, control, clock: new ClockSync(), pendingSync: new Map() };
    notify.addEventListener('characteristicvaluechanged', (ev) => {
      const target = ev.target as BluetoothRemoteGATTCharacteristic;
      if (target.value) this.onPacket(link, target.value);
    });
    await notify.startNotifications();
    device.addEventListener('gattserverdisconnected', () => {
      this.links.delete(stickId);
      this.emit({ kind: 'status', stickId, connected: false });
      if (this.links.size === 0) this.setState('disconnected', '스틱 연결이 끊어졌습니다');
      // TODO PLAY-01: 3회 자동 재연결
    });
    this.links.set(stickId, link);
    this.setState('connected');
    this.emit({ kind: 'status', stickId, connected: true });
    await this.syncClock(link);
  }

  private onPacket(link: StickLink, data: DataView): void {
    const recvTime = performance.now();
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    // 구독자가 있을 때만 복사해 넘긴다(버퍼 재사용 대비)
    if (packetTap.active) {
      packetTap.publish({ dir: 'in', transport: 'ble', stickId: link.stickId, bytes: bytes.slice(), recvTime });
    }
    const p = parsePacket(bytes, recvTime);
    if (!p) return;
    if (p.kind === 'syncAck') {
      const t0 = link.pendingSync.get(p.t0);
      if (t0 !== undefined) {
        link.pendingSync.delete(p.t0);
        link.clock.addSample(t0, p.t1, recvTime);
      }
      return;
    }
    // 패킷의 stickId보다 페어링 때 사용자가 고른 손을 신뢰한다
    if (p.kind === 'hit') {
      this.emit({ ...p, stickId: link.stickId, timestamp: link.clock.toBrowserTime(p.timestamp, recvTime) });
    } else if (p.kind === 'pose') {
      this.emit({ ...p, stickId: link.stickId, timestamp: link.clock.toBrowserTime(p.timestamp, recvTime) });
    } else {
      this.emit({ ...p, stickId: link.stickId });
    }
  }

  private async syncClock(link: StickLink, rounds = 5): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const key = Math.floor(t0) >>> 0;
      link.pendingSync.set(key, t0);
      try {
        await this.write(link, encodeSync(t0));
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /** 제어 특성에 쓰고 탭에 송신 기록을 남긴다 */
  private async write(link: StickLink, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    await link.control.writeValueWithoutResponse(bytes);
    packetTap.publish({ dir: 'out', transport: 'ble', stickId: link.stickId, bytes, recvTime: performance.now() });
  }

  clockOffset(stickId: StickId): number | null {
    return this.links.get(stickId)?.clock.offset ?? null;
  }

  clockOffsetOf(stickId: StickId): number | null {
    return this.clockOffset(stickId);
  }

  transportStats(): TransportStats {
    return { crcErrors: 0, resyncCount: 0, droppedBytes: 0, reconnects: 0 };
  }

  /** 지정한 링크(없으면 연결된 전부)에 명령 바이트를 그대로 쓴다 */
  sendCommand(bytes: Uint8Array, stickId?: StickId): void {
    const buf = new Uint8Array(bytes);
    const targets = stickId === undefined ? [...this.links.values()] : [this.links.get(stickId)];
    for (const l of targets) if (l) void this.write(l, buf).catch(() => {});
  }

  setPoseStream(enabled: boolean): void {
    const mode = enabled ? StreamMode.HIT_AND_POSE : StreamMode.HIT_ONLY;
    for (const l of this.links.values()) void this.write(l, encodeSetMode(mode)).catch(() => {});
  }

  resetPose(): void {
    for (const l of this.links.values()) void this.write(l, encodeResetPose()).catch(() => {});
  }

  haptic(stickId: StickId, strength: number, durationMs: number): void {
    const l = this.links.get(stickId);
    if (l) void this.write(l, encodeHaptic(strength, durationMs)).catch(() => {});
  }

  /** connect()는 페어링 창을 띄울 수 없다(제스처 필요). UI에서 pair(0)/pair(1)을 직접 부른다 */
  async connect(): Promise<void> {
    if (this.links.size > 0) this.setState('connected');
    if (this.syncTimer === null) {
      // 주기적 재동기화 (드리프트 대응)
      this.syncTimer = window.setInterval(() => {
        for (const l of this.links.values()) void this.syncClock(l, 2);
      }, 30_000);
    }
  }

  async disconnect(): Promise<void> {
    if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
    this.syncTimer = null;
    for (const l of this.links.values()) l.device.gatt?.disconnect();
    this.links.clear();
    this.setState('disconnected');
  }
}

export const bleDescriptor: SourceDescriptor = {
  id: 'ble',
  label: 'BLE 스틱',
  description: 'Web Bluetooth로 스틱 2개를 직접 연결 (하드웨어 필요)',
  availability: () =>
    BleStickSource.isSupported()
      ? { ok: true }
      : { ok: false, reason: '이 브라우저는 Web Bluetooth를 지원하지 않습니다. Chrome 또는 Edge를 쓰세요.' },
  create: () => new BleStickSource(),
  // 페어링 창은 사용자 제스처 안에서만 열 수 있어 버튼으로 노출한다
  actions: [
    { label: '왼손 스틱 페어링', run: (instance: BleStickSource) => instance.pair(0) },
    { label: '오른손 스틱 페어링', run: (instance: BleStickSource) => instance.pair(1) },
  ],
  note: '서비스 UUID a7d50001-… 를 광고하는 기기만 목록에 뜹니다.',
};
