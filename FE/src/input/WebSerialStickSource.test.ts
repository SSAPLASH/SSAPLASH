import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSerialStickSource } from './WebSerialStickSource';

function fakePort(open: () => Promise<void>) {
  return {
    readable: { getReader: () => ({ read: () => new Promise(() => {}), releaseLock() {}, cancel: async () => {} }) },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
    open: vi.fn(open),
    close: vi.fn(async () => {}),
  };
}

function stubSerial(ports: unknown[]) {
  const serial = {
    getPorts: vi.fn(async () => ports),
    requestPort: vi.fn(async () => ports[0]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('navigator', { serial });
  // node 환경이라 window가 없다. 타이머만 빌려 쓴다
  vi.stubGlobal('window', { setInterval, clearInterval });
  return serial;
}

describe('WebSerialStickSource.autoConnect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('허락한 포트가 있으면 포트 선택 없이 연다', async () => {
    const port = fakePort(async () => {});
    const serial = stubSerial([port]);
    const src = new WebSerialStickSource();
    await src.autoConnect();
    expect(port.open).toHaveBeenCalledOnce();
    expect(serial.requestPort).not.toHaveBeenCalled();
    expect(src.state).toBe('connected');
    await src.disconnect();
  });

  it('허락한 포트가 없으면 조용히 끊김으로 둔다', async () => {
    const serial = stubSerial([]);
    const src = new WebSerialStickSource();
    await expect(src.autoConnect()).resolves.toBeUndefined();
    expect(src.state).toBe('disconnected');
    expect(serial.requestPort).not.toHaveBeenCalled();
  });

  it('열기에 실패해도 던지지 않고 끊김으로 둔다', async () => {
    stubSerial([fakePort(async () => Promise.reject(new Error('busy')))]);
    const src = new WebSerialStickSource();
    await expect(src.autoConnect()).resolves.toBeUndefined();
    expect(src.state).toBe('disconnected');
  });
});
