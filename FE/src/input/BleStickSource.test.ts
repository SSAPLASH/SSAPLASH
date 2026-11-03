// BleStickSource: 실기기 없이 navigator.bluetooth·BluetoothDevice를 흉내 내 재연결·리스너 등록을 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StickEvent } from '@/domain/events';
import { BleStickSource } from './BleStickSource';

/** 특성 흉내: 이벤트 대상 + notify 시작 + 제어 쓰기 */
function fakeChar() {
  const c = new EventTarget() as EventTarget & {
    startNotifications: () => Promise<void>;
    writeValueWithoutResponse: (b: Uint8Array) => Promise<void>;
  };
  c.startNotifications = vi.fn(async () => {});
  c.writeValueWithoutResponse = vi.fn(async () => {});
  return c;
}

/** 기기 흉내: gatt.connect 호출마다 새 특성을 내준다. drop()으로 끊김을 일으킨다 */
function fakeDevice() {
  const dev = new EventTarget() as EventTarget & { gatt: { connect: ReturnType<typeof vi.fn>; disconnect: () => void }; drop: () => void };
  const connect = vi.fn(async () => ({
    getPrimaryService: async () => ({ getCharacteristic: async () => fakeChar() }),
  }));
  dev.gatt = { connect, disconnect: () => {} };
  dev.drop = () => dev.dispatchEvent(new Event('gattserverdisconnected'));
  vi.spyOn(dev, 'addEventListener');
  return dev;
}

describe('BleStickSource', () => {
  let src: BleStickSource;
  let events: StickEvent[];
  let requestDevice: ReturnType<typeof vi.fn>;

  /** 페어링·재연결은 SYNC 5회(60ms 간격)를 기다리므로 타이머를 돌려 끝낸다 */
  async function settle(p: Promise<void>): Promise<void> {
    await vi.advanceTimersByTimeAsync(500);
    await p;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    requestDevice = vi.fn();
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
    src = new BleStickSource();
    events = [];
    src.subscribe((e) => events.push(e));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const statuses = () => events.flatMap((e) => (e.kind === 'status' ? [[e.stickId, e.connected]] : []));

  it('pair 뒤 끊기면 끊김 이벤트와 disconnected, autoConnect가 같은 기기에 gatt.connect를 다시 불러 복구한다', async () => {
    const dev = fakeDevice();
    requestDevice.mockResolvedValue(dev);
    await settle(src.pair(0));
    expect(src.state).toBe('connected');
    expect(dev.gatt.connect).toHaveBeenCalledTimes(1);

    dev.drop();
    expect(src.state).toBe('disconnected');
    expect(statuses()).toEqual([
      [0, true],
      [0, false],
    ]);

    await settle(src.autoConnect());
    expect(dev.gatt.connect).toHaveBeenCalledTimes(2);
    expect(requestDevice).toHaveBeenCalledTimes(1); // 선택 창은 다시 뜨지 않는다
    expect(src.state).toBe('connected');
    expect(statuses().at(-1)).toEqual([0, true]);
  });

  it('autoConnect: 보관 기기가 없으면 무동작, 모두 연결돼 있으면 무동작, 연결 실패는 던지지 않는다', async () => {
    await src.autoConnect();
    expect(events).toHaveLength(0);

    const dev = fakeDevice();
    requestDevice.mockResolvedValue(dev);
    await settle(src.pair(0));
    await src.autoConnect();
    expect(dev.gatt.connect).toHaveBeenCalledTimes(1);

    dev.drop();
    dev.gatt.connect.mockRejectedValueOnce(new Error('꺼져 있음'));
    await expect(src.autoConnect()).resolves.toBeUndefined();
    expect(src.state).toBe('disconnected');
  });

  it('autoConnect는 끊긴 기기만 다시 붙인다(한 손만 끊김)', async () => {
    const left = fakeDevice();
    const right = fakeDevice();
    requestDevice.mockResolvedValueOnce(left).mockResolvedValueOnce(right);
    await settle(src.pair(0));
    await settle(src.pair(1));
    right.drop();
    expect(src.state).toBe('connected');
    await settle(src.autoConnect());
    expect(left.gatt.connect).toHaveBeenCalledTimes(1);
    expect(right.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it('같은 기기를 두 번 pair해도 gattserverdisconnected 리스너는 기기당 1개', async () => {
    const dev = fakeDevice();
    requestDevice.mockResolvedValue(dev);
    await settle(src.pair(0));
    await settle(src.pair(0));
    const calls = (dev.addEventListener as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'gattserverdisconnected',
    );
    expect(calls).toHaveLength(1);
    // 끊김 알림도 한 번만 나간다
    dev.drop();
    expect(statuses().filter((s) => s[1] === false)).toHaveLength(1);
  });

  it('disconnect는 보관 기기를 비워 autoConnect가 아무것도 하지 않는다', async () => {
    const dev = fakeDevice();
    requestDevice.mockResolvedValue(dev);
    await settle(src.pair(0));
    await src.disconnect();
    await src.autoConnect();
    expect(dev.gatt.connect).toHaveBeenCalledTimes(1);
  });
});
