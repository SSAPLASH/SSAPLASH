import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setReconnectHandler, useReconnect, type ReconnectHandler } from './reconnectStore';

beforeEach(() => {
  vi.useFakeTimers();
  setReconnectHandler(null);
});
afterEach(() => {
  setReconnectHandler(null);
  vi.useRealTimers();
});

/** 취소되면 reject, 아니면 3초 뒤 reject하는 핸들러(시간 안에 손이 안 붙은 경우) */
function timeoutHandler() {
  return vi.fn<ReconnectHandler>(
    (_n, signal) =>
      new Promise<void>((_res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), 3000);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          rej(new Error('abort'));
        });
      }),
  );
}

describe('reconnectStore', () => {
  it('핸들러가 없으면 available=false이고 start·reconnect는 무시된다', async () => {
    expect(useReconnect.getState().available).toBe(false);
    useReconnect.getState().start();
    await useReconnect.getState().reconnect();
    expect(useReconnect.getState().status).toBe('idle');
    expect(useReconnect.getState().attempt).toBe(0);
  });

  it('핸들러를 등록하면 available=true이고 hint를 보관한다', () => {
    setReconnectHandler(async () => {}, '동글을 뺐다 다시 꽂아 주세요');
    expect(useReconnect.getState().available).toBe(true);
    expect(useReconnect.getState().hint).toBe('동글을 뺐다 다시 꽂아 주세요');
    expect(useReconnect.getState().status).toBe('idle');
  });

  it('start는 자동으로 3회 시도하고 attempt가 1, 2, 3으로 표시된 뒤 failed가 된다', async () => {
    const h = timeoutHandler();
    setReconnectHandler(h);
    useReconnect.getState().start();
    expect(useReconnect.getState()).toMatchObject({ status: 'trying', attempt: 1 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(useReconnect.getState()).toMatchObject({ status: 'trying', attempt: 2 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(useReconnect.getState()).toMatchObject({ status: 'trying', attempt: 3 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(useReconnect.getState().status).toBe('failed');
    expect(h).toHaveBeenCalledTimes(3);
  });

  it('시도 중 start는 무시된다', () => {
    const h = timeoutHandler();
    setReconnectHandler(h);
    useReconnect.getState().start();
    useReconnect.getState().start();
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('핸들러가 resolve하면 reconnected가 되고 1초 뒤 idle로 돌아온다', async () => {
    setReconnectHandler(async () => {});
    useReconnect.getState().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(useReconnect.getState()).toMatchObject({ status: 'reconnected', attempt: 0 });
    await vi.advanceTimersByTimeAsync(999);
    expect(useReconnect.getState().status).toBe('reconnected');
    await vi.advanceTimersByTimeAsync(1);
    expect(useReconnect.getState().status).toBe('idle');
  });

  it('settle은 진행 중 시도를 취소하고 reconnected로 둔다. idle에서는 무동작', () => {
    useReconnect.getState().settle();
    expect(useReconnect.getState().status).toBe('idle');
    const h = timeoutHandler();
    setReconnectHandler(h);
    useReconnect.getState().start();
    const signal = h.mock.calls[0][1];
    useReconnect.getState().settle();
    expect(signal.aborted).toBe(true);
    expect(useReconnect.getState().status).toBe('reconnected');
  });

  it('settle이 다시 오면 1초 타이머를 다시 센다', async () => {
    setReconnectHandler(timeoutHandler());
    useReconnect.getState().start();
    useReconnect.getState().settle();
    await vi.advanceTimersByTimeAsync(600);
    useReconnect.getState().settle();
    await vi.advanceTimersByTimeAsync(600);
    expect(useReconnect.getState().status).toBe('reconnected');
    await vi.advanceTimersByTimeAsync(400);
    expect(useReconnect.getState().status).toBe('idle');
  });

  it('trying 중 reconnect는 현재 시도를 abort하고 다음 번호로 넘어간다', async () => {
    const h = timeoutHandler();
    setReconnectHandler(h);
    useReconnect.getState().start();
    const first = h.mock.calls[0][1];
    await useReconnect.getState().reconnect();
    expect(first.aborted).toBe(true);
    expect(useReconnect.getState()).toMatchObject({ status: 'trying', attempt: 2 });
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('3회째에 reconnect를 누르면 failed가 된다', async () => {
    setReconnectHandler(timeoutHandler());
    useReconnect.getState().start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(useReconnect.getState().attempt).toBe(3);
    await useReconnect.getState().reconnect();
    expect(useReconnect.getState().status).toBe('failed');
  });

  it('failed에서 reconnect는 1회부터 다시 시도한다', async () => {
    const h = timeoutHandler();
    setReconnectHandler(h);
    useReconnect.getState().start();
    await vi.advanceTimersByTimeAsync(9000);
    expect(useReconnect.getState().status).toBe('failed');
    await useReconnect.getState().reconnect();
    expect(useReconnect.getState()).toMatchObject({ status: 'trying', attempt: 1 });
    expect(h).toHaveBeenCalledTimes(4);
  });

  it('setReconnectHandler(null)은 진행 중 루프를 멈추고 available=false·idle로 돌린다', async () => {
    const h = timeoutHandler();
    setReconnectHandler(h, '안내');
    useReconnect.getState().start();
    const signal = h.mock.calls[0][1];
    setReconnectHandler(null);
    expect(signal.aborted).toBe(true);
    expect(useReconnect.getState()).toMatchObject({ available: false, status: 'idle', attempt: 0, hint: '' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(useReconnect.getState().status).toBe('idle');
    expect(h).toHaveBeenCalledTimes(1);
  });
});
