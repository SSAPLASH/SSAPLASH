import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@/domain/account/auth';
import type { SenderState } from './sender';
import {
  TELEMETRY_STORAGE_KEY,
  TelemetryController,
  browserEnableStorage,
  type EnableStorage,
} from './enable';

const SENDER_STATE: SenderState = {
  running: false,
  inflight: false,
  sent: 0,
  unknown: 0,
  rejected: 0,
  unauthorized: 0,
  drops: { overflow: 0, ttl: 0, oversize: 0 },
  queueSize: 0,
  lastError: null,
  forbidden: false,
};

function setup(opts: { stored?: boolean; role?: UserRole | null } = {}) {
  let stored = opts.stored ?? false;
  let role: UserRole | null = opts.role ?? null;
  const storageListeners = new Set<() => void>();
  const roleListeners = new Set<() => void>();
  const log: string[] = [];
  const storage: EnableStorage = {
    read: () => stored,
    write: (on) => {
      stored = on;
    },
    subscribe: (l) => {
      storageListeners.add(l);
      return () => storageListeners.delete(l);
    },
  };
  const sender = {
    start: vi.fn(() => log.push('sender.start')),
    stop: vi.fn(() => log.push('sender.stop')),
    flushOnce: vi.fn(async () => {
      log.push('flush');
    }),
    getState: () => SENDER_STATE,
    subscribe: () => () => {},
  };
  const collector = {
    start: vi.fn(() => log.push('collector.start')),
    stop: vi.fn(() => log.push('collector.stop')),
    setActiveSource: vi.fn(),
    notifyConnection: vi.fn(),
  };
  const queue = { clear: vi.fn(() => log.push('queue.clear')) };
  const c = new TelemetryController({
    storage,
    collector,
    sender,
    queue,
    getRole: () => role,
    subscribeRole: (l) => {
      roleListeners.add(l);
      return () => roleListeners.delete(l);
    },
  });
  return {
    c,
    sender,
    collector,
    queue,
    log,
    getStored: () => stored,
    /** 다른 창이 저장소를 바꾼 것처럼 */
    externalWrite(on: boolean) {
      stored = on;
      for (const l of storageListeners) l();
    },
    setRole(r: UserRole | null) {
      role = r;
      for (const l of roleListeners) l();
    },
  };
}

describe('TelemetryController', () => {
  it('켜기만 하고 ADMIN이 아니면 시작하지 않는다', () => {
    const t = setup({ role: 'USER' });
    t.c.setEnabled(true);
    expect(t.getStored()).toBe(true);
    expect(t.collector.start).not.toHaveBeenCalled();
    expect(t.sender.start).not.toHaveBeenCalled();
    expect(t.c.getSnapshot()).toMatchObject({ enabled: true, roleOk: false, active: false });
  });

  it('ADMIN이고 켜면 collector → sender 순으로 시작한다', () => {
    const t = setup({ role: 'ADMIN' });
    t.c.setEnabled(true);
    expect(t.log).toEqual(['collector.start', 'sender.start']);
    expect(t.c.getSnapshot()).toMatchObject({ enabled: true, roleOk: true, active: true });
  });

  it('저장소에 켜짐이 있으면 시작 때 읽고, 로그인 복원 뒤 ADMIN이 되면 시작한다', () => {
    const t = setup({ stored: true, role: null });
    expect(t.sender.start).not.toHaveBeenCalled();
    t.setRole('ADMIN');
    expect(t.log).toEqual(['collector.start', 'sender.start']);
  });

  it('끄면 collector.stop → flushOnce → sender.stop, 큐를 비운다', async () => {
    const t = setup({ role: 'ADMIN' });
    t.c.setEnabled(true);
    t.log.length = 0;
    t.c.setEnabled(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.log).toEqual(['collector.stop', 'flush', 'sender.stop', 'queue.clear']);
    expect(t.getStored()).toBe(false);
    expect(t.c.getSnapshot().active).toBe(false);
  });

  it('로그아웃(ADMIN 상실)이면 남은 큐를 보내지 않고 바로 멈춘다', () => {
    const t = setup({ stored: true, role: 'ADMIN' });
    t.log.length = 0;
    t.setRole(null);
    expect(t.log).toEqual(['collector.stop', 'sender.stop', 'queue.clear']);
    // 저장소 켜기 값은 그대로라 다시 ADMIN이 되면 재개한다
    expect(t.getStored()).toBe(true);
    t.setRole('ADMIN');
    expect(t.sender.start).toHaveBeenCalledTimes(2);
  });

  it('flush 중 다시 켜지면 sender를 멈추지 않고 큐도 비우지 않는다', async () => {
    const t = setup({ role: 'ADMIN' });
    t.c.setEnabled(true);
    t.log.length = 0;
    t.c.setEnabled(false);
    t.c.setEnabled(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.log).toEqual(['collector.stop', 'flush', 'collector.start', 'sender.start']);
  });

  it('403이면 저장소 값을 끄고 사유를 남기며 flush는 하지 않는다', () => {
    const t = setup({ stored: true, role: 'ADMIN' });
    t.log.length = 0;
    t.c.handleForbidden();
    expect(t.getStored()).toBe(false);
    expect(t.c.getSnapshot()).toMatchObject({ enabled: false, active: false, forbidden: true });
    expect(t.sender.flushOnce).not.toHaveBeenCalled();
    expect(t.log).toEqual(['collector.stop', 'sender.stop', 'queue.clear']);
    // 다시 켜면 표시가 풀린다
    t.c.setEnabled(true);
    expect(t.c.getSnapshot()).toMatchObject({ enabled: true, active: true, forbidden: false });
  });

  it('다른 창의 저장소 변경(storage 이벤트)을 따라간다', () => {
    const t = setup({ role: 'ADMIN' });
    t.externalWrite(true);
    expect(t.c.getSnapshot().active).toBe(true);
    t.externalWrite(false);
    expect(t.c.getSnapshot()).toMatchObject({ enabled: false, active: false });
  });

  it('연결 변화는 활성일 때만 collector로 넘긴다', () => {
    const t = setup({ role: 'ADMIN' });
    t.c.notifyConnection(0, true, 'ws');
    expect(t.collector.notifyConnection).not.toHaveBeenCalled();
    t.c.setEnabled(true);
    t.c.notifyConnection(0, true, 'ws');
    expect(t.collector.notifyConnection).toHaveBeenCalledWith(0, true, 'ws');
  });

  it('스냅샷은 변화가 없으면 같은 참조이고, 변화 때만 구독자에게 알린다', () => {
    const t = setup({ role: 'ADMIN' });
    const a = t.c.getSnapshot();
    expect(t.c.getSnapshot()).toBe(a);
    const l = vi.fn();
    t.c.subscribe(l);
    t.c.setEnabled(true);
    expect(l).toHaveBeenCalled();
    expect(t.c.getSnapshot()).not.toBe(a);
  });
});

describe('browserEnableStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubLocalStorage(initial: Record<string, string> = {}) {
    const m = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    });
    return m;
  }

  it("'1'만 켜짐이고 쓰기는 '1'/'0'", () => {
    const m = stubLocalStorage();
    expect(browserEnableStorage.read()).toBe(false);
    browserEnableStorage.write(true);
    expect(m.get(TELEMETRY_STORAGE_KEY)).toBe('1');
    expect(browserEnableStorage.read()).toBe(true);
    browserEnableStorage.write(false);
    expect(m.get(TELEMETRY_STORAGE_KEY)).toBe('0');
    expect(browserEnableStorage.read()).toBe(false);
  });

  it('저장소가 던져도 꺼짐으로 읽고 쓰기는 조용히 실패한다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(browserEnableStorage.read()).toBe(false);
    expect(() => browserEnableStorage.write(true)).not.toThrow();
  });

  it('storage 이벤트는 이 키(또는 전체 비움)일 때만 알린다', () => {
    let handler: ((e: StorageEvent) => void) | null = null;
    vi.stubGlobal('window', {
      addEventListener: (_t: string, h: (e: StorageEvent) => void) => {
        handler = h;
      },
      removeEventListener: () => {
        handler = null;
      },
    });
    const l = vi.fn();
    const off = browserEnableStorage.subscribe(l);
    handler!({ key: 'other' } as StorageEvent);
    expect(l).not.toHaveBeenCalled();
    handler!({ key: TELEMETRY_STORAGE_KEY } as StorageEvent);
    handler!({ key: null } as StorageEvent);
    expect(l).toHaveBeenCalledTimes(2);
    off();
    expect(handler).toBeNull();
  });
});
