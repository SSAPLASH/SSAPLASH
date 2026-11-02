import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setReconnectHandler, useReconnect } from './reconnectStore';

beforeEach(() => setReconnectHandler(null));
afterEach(() => setReconnectHandler(null));

describe('reconnectStore', () => {
  it('핸들러가 없으면 available=false이고 reconnect는 무시된다', async () => {
    expect(useReconnect.getState().available).toBe(false);
    await useReconnect.getState().reconnect();
    expect(useReconnect.getState().status).toBe('idle');
    expect(useReconnect.getState().attempt).toBe(0);
  });

  it('핸들러를 등록하면 available=true', () => {
    setReconnectHandler(async () => {});
    expect(useReconnect.getState().available).toBe(true);
    expect(useReconnect.getState().status).toBe('idle');
  });

  it('성공하면 idle로 돌아온다', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    setReconnectHandler(run);
    await useReconnect.getState().reconnect();
    expect(run).toHaveBeenCalledTimes(1);
    expect(useReconnect.getState().status).toBe('idle');
    expect(useReconnect.getState().attempt).toBe(0);
  });

  it('거부되면 failed가 된다', async () => {
    setReconnectHandler(() => Promise.reject(new Error('연결 실패')));
    await useReconnect.getState().reconnect();
    expect(useReconnect.getState().status).toBe('failed');
  });

  it('시도 중에는 trying·attempt=1이고 중복 호출은 무시된다', async () => {
    let finish: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setReconnectHandler(run);
    const first = useReconnect.getState().reconnect();
    expect(useReconnect.getState().status).toBe('trying');
    expect(useReconnect.getState().attempt).toBe(1);
    await useReconnect.getState().reconnect();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(useReconnect.getState().status).toBe('idle');
  });

  it('실패 뒤 다시 시도할 수 있다', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined);
    setReconnectHandler(run);
    await useReconnect.getState().reconnect();
    expect(useReconnect.getState().status).toBe('failed');
    await useReconnect.getState().reconnect();
    expect(run).toHaveBeenCalledTimes(2);
    expect(useReconnect.getState().status).toBe('idle');
  });

  it('핸들러를 해제하면 idle·available=false로 돌아간다', async () => {
    setReconnectHandler(() => Promise.reject(new Error('x')));
    await useReconnect.getState().reconnect();
    expect(useReconnect.getState().status).toBe('failed');
    setReconnectHandler(null);
    expect(useReconnect.getState().available).toBe(false);
    expect(useReconnect.getState().status).toBe('idle');
    expect(useReconnect.getState().attempt).toBe(0);
  });
});
