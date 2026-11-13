// PLAY-01 Web Bluetooth 스틱 연결. 스틱 하나 = BLE 주변기기 하나. 두 개를 각각 연결한다.
// 하드웨어가 없는 동안은 미검증 — 프로토콜(stickProtocol.ts)과 흐름만 맞춰 둔다.
// 페어링한 BluetoothDevice는 끊겨도 보관한다. 끊기면 autoConnect()가 선택 창 없이 gatt.connect()로 다시 붙는다
// (재연결 시도는 사용자 제스처가 필요 없는 동작만 쓴다). 끊김 리스너는 기기당 한 번만 단다.
import type { DeviceRole, StickId } from '@/domain/events';
import { BaseInputSource, ClockSync, SYNC_INTERVAL_MS } from './InputSource';
import type { TransportStats } from './InputSource';
import { MAX_PENDING_SYNC } from '@/input/deviceState';
import { packetTap } from '@/input/packetTap';
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
} from '@/input/stickProtocol';

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
  /** 페어링한 기기. 끊겨도 지우지 않고 disconnect()에서만 비운다 */
  private devices = new Map<StickId, BluetoothDevice>();
  /** gattserverdisconnected 리스너를 이미 단 기기(다시 페어링해도 누적하지 않는다) */
  private listening = new WeakSet<BluetoothDevice>();
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
    const prev = this.devices.get(stickId);
    if (prev && prev !== device) this.links.delete(stickId);
    this.devices.set(stickId, device);
    this.listenDisconnect(device);
    await this.attach(device, stickId);
  }

  /** 기기당 한 번만 끊김 리스너를 단다. 어느 손의 기기인지는 끊길 때 devices에서 찾는다 */
  private listenDisconnect(device: BluetoothDevice): void {
    if (this.listening.has(device)) return;
    this.listening.add(device);
    device.addEventListener('gattserverdisconnected', () => {
      for (const [stickId, d] of this.devices) {
        if (d !== device) continue;
        this.links.delete(stickId);
        this.emit({ kind: 'status', stickId, connected: false });
      }
      if (this.links.size === 0) this.setState('disconnected', '스틱 연결이 끊어졌습니다');
    });
  }

  /** GATT 연결 → 서비스·특성 얻기 → notify 시작 → 링크 등록 → 연결 이벤트·SYNC. pair·autoConnect가 공용 */
  private async attach(device: BluetoothDevice, stickId: StickId): Promise<void> {
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(STICK_SERVICE_UUID);
    const notify = await service.getCharacteristic(STICK_NOTIFY_UUID);
    const control = await service.getCharacteristic(STICK_CONTROL_UUID);
    const link: StickLink = { stickId, device, notify, control, clock: new ClockSync(), pendingSync: new Map() };
    // 특성 객체는 attach마다 새로 얻으므로 이 리스너는 누적되지 않는다
    notify.addEventListener('characteristicvaluechanged', (ev) => {
      const target = ev.target as BluetoothRemoteGATTCharacteristic;
      if (target.value) this.onPacket(link, target.value);
    });
    await notify.startNotifications();
    this.links.set(stickId, link);
    this.setState('connected');
    this.emit({ kind: 'status', stickId, connected: true });
    await this.syncClock(link);
  }

  /**
   * 재연결용. 보관한 기기 중 끊긴 것마다 선택 창 없이 gatt.connect()를 시도한다.
   * 보관 기기가 없거나 모두 연결돼 있으면 무동작. 실패해도 던지지 않는다
   */
  async autoConnect(): Promise<void> {
    const targets = [...this.devices].filter(([stickId]) => !this.links.has(stickId));
    if (targets.length === 0) return;
    await Promise.all(
      targets.map(async ([stickId, device]) => {
        try {
          await this.attach(device, stickId);
        } catch {
          // 스틱이 꺼져 있으면 실패한다. 다음 시도에서 다시 붙는다
        }
      }),
    );
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
    // 페달(role 2·3) 이벤트는 동글 소스만 쓴다
    if (p.kind === 'pedal' || p.kind === 'pedalStatus' || (p.kind === 'hit' && p.foot !== undefined)) return;
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
      // 답이 없는 SYNC가 쌓이지 않게 오래된 것부터 버린다
      while (link.pendingSync.size > MAX_PENDING_SYNC) link.pendingSync.delete(link.pendingSync.keys().next().value!);
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

  clockOffsetOf(role: DeviceRole): number | null {
    // 발(role 2·3)은 BLE 직결에 없다
    return role === 0 || role === 1 ? this.clockOffset(role) : null;
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
      // 주기적 재동기화 (드리프트 대응). 1초마다 1회
      this.syncTimer = window.setInterval(() => {
        for (const l of this.links.values()) void this.syncClock(l, 1);
      }, SYNC_INTERVAL_MS);
    }
  }

  async disconnect(): Promise<void> {
    if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
    this.syncTimer = null;
    for (const l of this.links.values()) l.device.gatt?.disconnect();
    this.links.clear();
    this.devices.clear();
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
