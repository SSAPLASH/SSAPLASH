// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installPreloadErrorHandler, isChunkLoadError, RELOAD_GUARD_KEY, RELOAD_GUARD_MS, tryAutoReload } from './chunkRecovery';

function fakeStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RELOAD_GUARD_KEY, initial);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/a.js',
    'error loading dynamically imported module: https://x/a.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/a.css',
    'FAILED TO FETCH DYNAMICALLY IMPORTED MODULE',
  ])('문구 %s는 참', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('name이 ChunkLoadError면 참', () => {
    const e = new Error('x');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  it('일반 오류·비객체는 거짓', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
    expect(isChunkLoadError({ message: 42 })).toBe(false);
  });

  it('message를 가진 일반 객체도 판별한다', () => {
    expect(isChunkLoadError({ message: 'Importing a module script failed' })).toBe(true);
  });
});

describe('tryAutoReload', () => {
  it('첫 실패는 기록 후 새로고침', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    expect(tryAutoReload('/history', { busy: false, now: 1000, storage, reload })).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data.get(RELOAD_GUARD_KEY)!)).toEqual({ path: '/history', at: 1000 });
  });

  it('30초 안 같은 경로는 blocked', () => {
    const storage = fakeStorage(JSON.stringify({ path: '/history', at: 1000 }));
    const reload = vi.fn();
    expect(tryAutoReload('/history', { busy: false, now: 1000 + RELOAD_GUARD_MS - 1, storage, reload })).toBe('blocked');
    expect(reload).not.toHaveBeenCalled();
  });

  it('30초가 지나면 다시 새로고침', () => {
    const storage = fakeStorage(JSON.stringify({ path: '/history', at: 1000 }));
    const reload = vi.fn();
    expect(tryAutoReload('/history', { busy: false, now: 1000 + RELOAD_GUARD_MS, storage, reload })).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('다른 경로는 새로고침', () => {
    const storage = fakeStorage(JSON.stringify({ path: '/history', at: 1000 }));
    const reload = vi.fn();
    expect(tryAutoReload('/settings', { busy: false, now: 2000, storage, reload })).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('busy면 blocked, 기록도 하지 않는다', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    expect(tryAutoReload('/free', { busy: true, now: 1, storage, reload })).toBe('blocked');
    expect(reload).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
  });

  it('getItem이 throw하면 blocked', () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(tryAutoReload('/a', { busy: false, storage, reload })).toBe('blocked');
    expect(reload).not.toHaveBeenCalled();
  });

  it('setItem이 throw하면 blocked', () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(tryAutoReload('/a', { busy: false, storage, reload })).toBe('blocked');
    expect(reload).not.toHaveBeenCalled();
  });

  it('깨진 JSON은 기록 없음으로 본다', () => {
    const storage = fakeStorage('{not json');
    const reload = vi.fn();
    expect(tryAutoReload('/a', { busy: false, now: 5, storage, reload })).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('installPreloadErrorHandler', () => {
  // 리스너는 제거할 수 없으니 한 번만 달고 busy 값은 변수로 바꾼다
  let busyNow = false;
  beforeAll(() => installPreloadErrorHandler(() => busyNow));
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // happy-dom의 location.reload는 실제 이동을 하지 않지만 호출 여부를 보려고 spy를 건다
  function fire(busy: boolean) {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    busyNow = busy;
    const event = new Event('vite:preloadError', { cancelable: true });
    const prevent = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    return { prevent, reload };
  }

  it('새로고침하면 preventDefault를 호출한다', () => {
    const { prevent, reload } = fire(false);
    expect(prevent).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('blocked면 preventDefault를 호출하지 않는다', () => {
    const { prevent, reload } = fire(true);
    expect(prevent).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
