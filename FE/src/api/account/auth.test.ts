import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REFRESH_RETRY_DELAY_MS,
  getAccessToken,
  loginUrl,
  logout,
  refreshAccessToken,
  resetForTest,
  subscribeSession,
} from './auth';
import { ApiError } from '@/api/http';

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** fetch를 핸들러로 대체한다. 호출 기록은 돌려주는 mock으로 본다 */
function mockFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const problem401 = () =>
  json(401, { status: 401, code: 'UNAUTHORIZED', detail: '다시 로그인해 주세요.' }, 'application/problem+json');
const tokenOk = (accessToken: string) => json(200, { accessToken, tokenType: 'Bearer', expiresIn: 1800 });

beforeEach(() => resetForTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('refreshAccessToken', () => {
  it('200이면 토큰을 저장하고 구독자에게 알린다', async () => {
    const fetch = mockFetch(() => tokenOk('t1'));
    const listener = vi.fn();
    subscribeSession(listener);

    await expect(refreshAccessToken()).resolves.toBe('t1');

    expect(getAccessToken()).toBe('t1');
    expect(listener).toHaveBeenCalledWith('t1');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/auth/refresh');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
  });

  it('동시에 여러 번 불러도 요청은 한 번이다 (단일 실행)', async () => {
    const fetch = mockFetch(() => tokenOk('t2'));

    const results = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);

    expect(results).toEqual(['t2', 't2', 't2']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('끝난 뒤 다시 부르면 새 요청을 보낸다', async () => {
    const fetch = mockFetch(() => tokenOk('t3'));
    await refreshAccessToken();
    await refreshAccessToken();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('401이면 잠시 뒤 한 번 더 시도하고, 그때 200이면 로그인이 유지된다 (두 탭 회전 경쟁)', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetch = mockFetch(() => (n++ === 0 ? problem401() : tokenOk('t4')));
    const listener = vi.fn();
    subscribeSession(listener);

    const p = refreshAccessToken();
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);

    await expect(p).resolves.toBe('t4');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe('t4');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('t4');
  });

  it('재시도도 401이면 토큰을 비우고 null을 돌려주며 구독자에게 null을 알린다', async () => {
    vi.useFakeTimers();
    resetForTest('old');
    const fetch = mockFetch(() => problem401());
    const listener = vi.fn();
    subscribeSession(listener);

    const p = refreshAccessToken();
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);

    await expect(p).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
    expect(listener).toHaveBeenCalledWith(null);
  });

  it('5xx면 ApiError를 던지고 기존 토큰은 유지하며 알리지 않는다', async () => {
    resetForTest('old');
    mockFetch(() => json(500, { status: 500, code: 'INTERNAL_ERROR', detail: '서버 오류' }, 'application/problem+json'));
    const listener = vi.fn();
    subscribeSession(listener);

    await expect(refreshAccessToken()).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });

    expect(getAccessToken()).toBe('old');
    expect(listener).not.toHaveBeenCalled();
  });

  it('네트워크 오류면 code NETWORK인 ApiError를 던지고 토큰은 유지한다', async () => {
    resetForTest('old');
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const err = await refreshAccessToken().catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
    expect(getAccessToken()).toBe('old');
  });

  it('실패한 뒤에는 단일 실행 잠금이 풀려 다시 부를 수 있다', async () => {
    let n = 0;
    const fetch = mockFetch(() => (n++ === 0 ? json(500, {}) : tokenOk('t5')));
    await refreshAccessToken().catch(() => undefined);
    await expect(refreshAccessToken()).resolves.toBe('t5');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('logout', () => {
  it('POST /api/auth/logout 뒤 토큰을 비우고 구독자에게 null을 알린다', async () => {
    resetForTest('old');
    const fetch = mockFetch(() => new Response(null, { status: 204 }));
    const listener = vi.fn();
    subscribeSession(listener);

    await logout();

    expect(fetch.mock.calls[0][0]).toBe('/api/auth/logout');
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
    expect(getAccessToken()).toBeNull();
    expect(listener).toHaveBeenCalledWith(null);
  });

  it('요청이 실패해도 토큰은 비우고 throw하지 않는다', async () => {
    resetForTest('old');
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(logout()).resolves.toBeUndefined();

    expect(getAccessToken()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('subscribeSession', () => {
  it('해제하면 더 알리지 않는다', async () => {
    mockFetch(() => tokenOk('t6'));
    const listener = vi.fn();
    const off = subscribeSession(listener);
    off();
    await refreshAccessToken();
    expect(listener).not.toHaveBeenCalled();
  });

  it('값이 바뀌지 않으면 알리지 않는다 (null → 401 → null)', async () => {
    vi.useFakeTimers();
    mockFetch(() => problem401());
    const listener = vi.fn();
    subscribeSession(listener);
    const p = refreshAccessToken();
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    await p;
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('loginUrl', () => {
  it('제공자 로그인 시작 경로', () => {
    expect(loginUrl('google')).toBe('/api/auth/google/login');
    expect(loginUrl('ssafy')).toBe('/api/auth/ssafy/login');
  });
});
