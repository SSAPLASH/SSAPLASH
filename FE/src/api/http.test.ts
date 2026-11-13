import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, resetSignupIncompleteForTest, subscribeSignupIncomplete } from './http';
import { REFRESH_RETRY_DELAY_MS, getAccessToken, resetForTest } from '@/api/account/auth';

type Handler = (url: string, init: RequestInit | undefined, call: number) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  let call = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init, call++));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const problem = (status: number, code: string, detail: string, extra: Record<string, unknown> = {}) =>
  json(status, { type: 'about:blank', title: code, status, detail, instance: '/api/x', code, ...extra }, 'application/problem+json');
const tokenOk = (accessToken: string) => json(200, { accessToken, tokenType: 'Bearer', expiresIn: 1800 });

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

beforeEach(() => {
  resetForTest();
  resetSignupIncompleteForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('apiFetch 요청 구성', () => {
  it('토큰이 있으면 Bearer 헤더를 붙이고 JSON을 돌려준다', async () => {
    resetForTest('tok');
    const fetch = mockFetch(() => json(200, { id: 7, nickname: '원빈' }));

    const me = await apiFetch<{ id: number; nickname: string }>('/api/users/me');

    expect(me).toEqual({ id: 7, nickname: '원빈' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/users/me');
    expect(header(init, 'Authorization')).toBe('Bearer tok');
    expect(header(init, 'Accept')).toBe('application/json');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('토큰이 없으면 Authorization 헤더가 없다', async () => {
    const fetch = mockFetch(() => json(200, {}));
    await apiFetch('/api/songs');
    expect(header(fetch.mock.calls[0][1], 'Authorization')).toBeNull();
  });

  it('body가 있으면 JSON으로 직렬화하고 Content-Type을 붙인다', async () => {
    const fetch = mockFetch(() => json(201, { id: 1 }));
    await apiFetch('/api/presets', { method: 'POST', body: { name: '내 킷' } });
    const init = fetch.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: '내 킷' }));
    expect(header(init, 'Content-Type')).toBe('application/json');
  });

  it('FormData 본문은 Content-Type 없이 그대로 보낸다', async () => {
    const fetch = mockFetch(() => json(202, { jobId: 1 }));
    const form = new FormData();
    form.append('title', '곡');
    await apiFetch('/api/v1/songs/audio', { method: 'POST', body: form });
    const init = fetch.mock.calls[0][1];
    expect(header(init, 'Content-Type')).toBeNull();
    expect(init?.body).toBe(form);
  });

  it('headers로 준 Idempotency-Key가 요청에 실린다', async () => {
    const fetch = mockFetch(() => json(200, {}));
    await apiFetch('/api/x', { method: 'POST', body: {}, headers: { 'Idempotency-Key': 'abc' } });
    expect(header(fetch.mock.calls[0][1], 'Idempotency-Key')).toBe('abc');
  });

  it('204·빈 본문은 undefined', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(apiFetch('/api/presets/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('apiFetch 오류', () => {
  it('problem+json은 status·code·detail·errors·instance를 가진 ApiError', async () => {
    mockFetch(() =>
      problem(400, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', { errors: [{ field: 'name', message: '공백일 수 없습니다' }] }),
    );

    const err = await apiFetch('/api/presets', { method: 'POST', body: {} }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: '입력값을 확인해 주세요.',
      instance: '/api/x',
      errors: [{ field: 'name', message: '공백일 수 없습니다' }],
    });
    expect(err.message).toBe('입력값을 확인해 주세요.');
  });

  it('JSON이 아닌 오류 응답은 HTTP_ERROR', async () => {
    mockFetch(() => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const err = await apiFetch('/api/songs').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: 'HTTP_ERROR', errors: [], instance: null });
  });

  it('네트워크 실패는 status 0·code NETWORK', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await apiFetch('/api/songs').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('403은 그대로 ApiError로 전파한다 (refresh 안 함)', async () => {
    resetForTest('tok');
    const fetch = mockFetch(() => problem(403, 'FORBIDDEN', '권한이 없습니다.'));
    await expect(apiFetch('/api/admin/x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('apiFetch 401 처리', () => {
  it('401이면 refresh 한 번 뒤 새 토큰으로 같은 요청을 다시 보낸다', async () => {
    resetForTest('expired');
    const fetch = mockFetch((url, init) => {
      if (url === '/api/auth/refresh') return tokenOk('fresh');
      return header(init, 'Authorization') === 'Bearer fresh'
        ? json(200, { ok: true })
        : problem(401, 'UNAUTHORIZED', '액세스 토큰이 만료되었습니다.');
    });

    await expect(apiFetch('/api/users/me')).resolves.toEqual({ ok: true });

    expect(fetch.mock.calls.map(([u]) => u)).toEqual(['/api/users/me', '/api/auth/refresh', '/api/users/me']);
    expect(header(fetch.mock.calls[2][1], 'Authorization')).toBe('Bearer fresh');
    expect(getAccessToken()).toBe('fresh');
  });

  it('refresh가 null이면(세션 없음) 원래 401을 ApiError로 던지고 재시도하지 않는다', async () => {
    vi.useFakeTimers();
    resetForTest('expired');
    const fetch = mockFetch((url) =>
      url === '/api/auth/refresh'
        ? problem(401, 'UNAUTHORIZED', '다시 로그인해 주세요.')
        : problem(401, 'UNAUTHORIZED', '액세스 토큰이 만료되었습니다.'),
    );

    const p = apiFetch('/api/users/me').catch((e) => e);
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    const err = await p;

    expect(err).toMatchObject({ status: 401, code: 'UNAUTHORIZED', detail: '액세스 토큰이 만료되었습니다.' });
    expect(fetch.mock.calls.map(([u]) => u)).toEqual(['/api/users/me', '/api/auth/refresh', '/api/auth/refresh']);
    expect(getAccessToken()).toBeNull();
  });

  it('refresh가 throw하면(5xx·네트워크) 그 오류를 전파한다', async () => {
    resetForTest('expired');
    mockFetch((url) =>
      url === '/api/auth/refresh' ? problem(500, 'INTERNAL_ERROR', '서버 오류') : problem(401, 'UNAUTHORIZED', '만료'),
    );
    await expect(apiFetch('/api/users/me')).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('재시도는 한 번뿐이다: 새 토큰으로도 401이면 refresh를 다시 하지 않는다', async () => {
    resetForTest('expired');
    const fetch = mockFetch((url) => (url === '/api/auth/refresh' ? tokenOk('fresh') : problem(401, 'UNAUTHORIZED', '만료')));

    await expect(apiFetch('/api/users/me')).rejects.toMatchObject({ status: 401 });

    expect(fetch.mock.calls.map(([u]) => u)).toEqual(['/api/users/me', '/api/auth/refresh', '/api/users/me']);
  });

  it('noRetryOn401: refresh는 한 번 하되 원래 요청은 다시 보내지 않고 401을 던진다', async () => {
    resetForTest('expired');
    const fetch = mockFetch((url) => (url === '/api/auth/refresh' ? tokenOk('fresh') : problem(401, 'UNAUTHORIZED', '만료')));

    await expect(apiFetch('/api/telemetry/batches', { method: 'POST', body: {}, noRetryOn401: true })).rejects.toMatchObject({ status: 401 });

    expect(fetch.mock.calls.map(([u]) => u)).toEqual(['/api/telemetry/batches', '/api/auth/refresh']);
    expect(getAccessToken()).toBe('fresh');
  });

  it('noRetryOn401이어도 다음 요청은 새 토큰으로 나간다', async () => {
    resetForTest('expired');
    const fetch = mockFetch((url, init) => {
      if (url === '/api/auth/refresh') return tokenOk('fresh');
      return header(init, 'Authorization') === 'Bearer fresh' ? json(200, { ok: true }) : problem(401, 'UNAUTHORIZED', '만료');
    });
    await expect(apiFetch('/api/x', { noRetryOn401: true })).rejects.toMatchObject({ status: 401 });
    await expect(apiFetch('/api/x', { noRetryOn401: true })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('Retry-After(초)를 ApiError.retryAfterMs로 싣는다', async () => {
    mockFetch(() => new Response('{}', { status: 429, headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '3' } }));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 429, retryAfterMs: 3000 });
    mockFetch(() => new Response('', { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } }));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 429, retryAfterMs: null });
  });

  it('/api/auth/ 아래 경로의 401은 refresh하지 않는다', async () => {
    resetForTest('tok');
    const fetch = mockFetch(() => problem(401, 'UNAUTHORIZED', '다시 로그인해 주세요.'));
    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('동시에 여러 요청이 401을 받아도 refresh는 한 번이다', async () => {
    resetForTest('expired');
    const fetch = mockFetch((url, init) => {
      if (url === '/api/auth/refresh') return tokenOk('fresh');
      return header(init, 'Authorization') === 'Bearer fresh' ? json(200, { url }) : problem(401, 'UNAUTHORIZED', '만료');
    });

    await Promise.all([apiFetch('/api/a'), apiFetch('/api/b'), apiFetch('/api/c')]);

    expect(fetch.mock.calls.filter(([u]) => u === '/api/auth/refresh')).toHaveLength(1);
  });
});

describe('apiFetch 가입 미완료 알림', () => {
  it('403 SIGNUP_INCOMPLETE면 구독자에게 한 번 알리고 ApiError(403)를 그대로 던진다', async () => {
    resetForTest('tok');
    mockFetch(() => problem(403, 'SIGNUP_INCOMPLETE', '가입 동의가 필요합니다.'));
    const listener = vi.fn();
    subscribeSignupIncomplete(listener);

    await expect(apiFetch('/api/songs')).rejects.toMatchObject({ status: 403, code: 'SIGNUP_INCOMPLETE' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('다른 코드의 403·401은 알리지 않는다', async () => {
    resetForTest('tok');
    const listener = vi.fn();
    subscribeSignupIncomplete(listener);

    mockFetch(() => problem(403, 'FORBIDDEN', '권한이 없습니다.'));
    await expect(apiFetch('/api/songs')).rejects.toBeInstanceOf(ApiError);

    mockFetch((url) => (url === '/api/auth/refresh' ? json(401, {}) : problem(401, 'UNAUTHORIZED', '인증이 필요합니다.')));
    vi.useFakeTimers();
    const p = apiFetch('/api/songs').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    expect(await p).toMatchObject({ status: 401 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('해제하면 더 알리지 않는다', async () => {
    resetForTest('tok');
    mockFetch(() => problem(403, 'SIGNUP_INCOMPLETE', 'x'));
    const listener = vi.fn();
    const off = subscribeSignupIncomplete(listener);
    off();

    await expect(apiFetch('/api/songs')).rejects.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled();
  });
});
