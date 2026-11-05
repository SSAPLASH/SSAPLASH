import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hintFor, shouldResend, waitForDevices } from './reconnectPolicy';

describe('hintFor', () => {
  it('소스별 안내 문구를 돌려준다', () => {
    expect(hintFor('webserial')).toBe('동글을 뺐다 다시 꽂아 주세요');
    expect(hintFor('ble')).toBe('스틱 버튼을 눌러 켜 주세요');
    expect(hintFor('websocket')).toBe('브리지가 켜져 있는지 확인해 주세요');
    expect(hintFor('pointer')).toBe('');
  });
});

describe('shouldResend', () => {
  it('기록이 없거나 1초가 지났으면 true, 그 안이면 false', () => {
    expect(shouldResend(null, 100)).toBe(true);
    expect(shouldResend(1000, 1999)).toBe(false);
    expect(shouldResend(1000, 2000)).toBe(true);
  });
});

describe('waitForDevices', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** 간단한 구독 소스 */
  function makeStore(initial: boolean[]) {
    let state = initial;
    const listeners = new Set<() => void>();
    return {
      get: () => state,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      set: (next: boolean[]) => {
        state = next;
        for (const l of [...listeners]) l();
      },
      size: () => listeners.size,
    };
  }

  it('네 칸(손 둘·발 둘)이 모두 와야 resolve한다', async () => {
    const s = makeStore([true, true, false, false]);
    const p = waitForDevices(s.get, s.subscribe, 3000, new AbortController().signal);
    s.set([true, true, true, false]);
    expect(s.size()).toBe(1);
    s.set([true, true, true, true]);
    await expect(p).resolves.toBeUndefined();
    expect(s.size()).toBe(0);
  });

  it('이미 양손이 연결돼 있으면 즉시 resolve한다', async () => {
    const s = makeStore([true, true]);
    await expect(waitForDevices(s.get, s.subscribe, 3000, new AbortController().signal)).resolves.toBeUndefined();
    expect(s.size()).toBe(0);
  });

  it('한 손만 오면 계속 기다리다 양손이 되면 resolve하고 구독을 푼다', async () => {
    const s = makeStore([false, false]);
    const p = waitForDevices(s.get, s.subscribe, 3000, new AbortController().signal);
    s.set([true, false]);
    expect(s.size()).toBe(1);
    s.set([true, true]);
    await expect(p).resolves.toBeUndefined();
    expect(s.size()).toBe(0);
  });

  it('시간이 지나면 reject하고 구독을 푼다', async () => {
    const s = makeStore([true, false]);
    const p = waitForDevices(s.get, s.subscribe, 3000, new AbortController().signal);
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(s.size()).toBe(0);
  });

  it('signal이 취소되면 즉시 reject하고 구독을 푼다', async () => {
    const s = makeStore([false, false]);
    const ctrl = new AbortController();
    const p = waitForDevices(s.get, s.subscribe, 3000, ctrl.signal);
    const assertion = expect(p).rejects.toThrow();
    ctrl.abort();
    await assertion;
    expect(s.size()).toBe(0);
  });

  it('이미 취소된 signal이면 바로 reject한다', async () => {
    const s = makeStore([true, true]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(waitForDevices(s.get, s.subscribe, 3000, ctrl.signal)).rejects.toThrow();
  });
});
