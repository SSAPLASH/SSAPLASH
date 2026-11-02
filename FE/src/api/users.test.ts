import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from './auth';
import { putDataConsent } from './users';

beforeEach(() => resetForTest());
afterEach(() => vi.unstubAllGlobals());

describe('putDataConsent', () => {
  it('PUT /api/users/me/data-consent에 JSON 본문을 보내고 응답을 돌려준다', async () => {
    const saved = { agreed: true, version: '2026-11-02', updatedAt: '2026-11-02T01:00:00Z' };
    const fn = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(saved), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fn);

    const res = await putDataConsent({ agreed: true, version: '2026-11-02' });

    expect(res).toEqual(saved);
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/users/me/data-consent');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('{"agreed":true,"version":"2026-11-02"}');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });
});
