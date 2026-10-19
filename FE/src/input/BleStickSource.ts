// PLAY-01 Web Bluetooth 스틱 연결. 스틱 하나 = BLE 주변기기 하나. 두 개를 각각 연결한다.
// 하드웨어가 없는 동안은 미검증 — 프로토콜(stickProtocol.ts)과 흐름만 맞춰 둔다.
import type { StickId } from '@/domain/events';
import { BaseInputSource, ClockSync } from './InputSource';
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
    const p = parsePacket(data, recvTime);
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
        await link.control.writeValueWithoutResponse(encodeSync(t0));
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  clockOffset(stickId: StickId): number | null {
    return this.links.get(stickId)?.clock.offset ?? null;
  }

  setPoseStream(enabled: boolean): void {
    const mode = enabled ? StreamMode.HIT_AND_POSE : StreamMode.HIT_ONLY;
    for (const l of this.links.values()) void l.control.writeValueWithoutResponse(encodeSetMode(mode)).catch(() => {});
  }

  resetPose(): void {
    for (const l of this.links.values()) void l.control.writeValueWithoutResponse(encodeResetPose()).catch(() => {});
  }

  haptic(stickId: StickId, strength: number, durationMs: number): void {
    const l = this.links.get(stickId);
    if (l) void l.control.writeValueWithoutResponse(encodeHaptic(strength, durationMs)).catch(() => {});
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
