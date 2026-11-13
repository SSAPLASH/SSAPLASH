import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindSignupIncomplete } from './signupGate';
import { resetForTest } from '@/api/account/auth';
import { apiFetch, resetSignupIncompleteForTest } from '@/api/http';
import type { UserMe } from '@/domain/account/auth';
import { termVersion } from '@/domain/account/signupTerms';
import { resetAuthStoreForTest, useAuth } from '@/store/authStore';

const NOW = '2026-11-02T01:00:00Z';
const DONE: UserMe = {
  id: 1,
  provider: 'GOOGLE',
  nickname: '곰',
  profileImageUrl: null,
  role: 'USER',
  createdAt: NOW,
  updatedAt: NOW,
  dataConsent: { agreed: true, version: termVersion('dataConsent'), updatedAt: NOW },
  signupCompleted: true,
  consents: { terms: { version: termVersion('terms'), agreedAt: NOW }, privacy: { version: termVersion('privacy'), agreedAt: NOW } },
};
const REVOKED: UserMe = { ...DONE, signupCompleted: false };

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

/** /api/users/me는 me를, 그 밖은 403 SIGNUP_INCOMPLETE를 돌려준다 */
function mockServer(me: UserMe) {
  const fn = vi.fn(async (url: string) =>
    url === '/api/users/me' ? json(200, me) : json(403, { status: 403, code: 'SIGNUP_INCOMPLETE', detail: 'x' }, 'application/problem+json'),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const meCalls = (fn: ReturnType<typeof mockServer>) => fn.mock.calls.filter(([u]) => u === '/api/users/me').length;
/** refreshMe 후속 작업(비동기)이 끝나도록 마이크로태스크를 비운다 */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let unbind: () => void = () => {};

beforeEach(() => {
  resetForTest('tok');
  resetAuthStoreForTest();
  resetSignupIncompleteForTest();
});
afterEach(() => {
  unbind();
  unbind = () => {};
  vi.unstubAllGlobals();
});

describe('bindSignupIncomplete', () => {
  it('403 SIGNUP_INCOMPLETE를 받으면 /me를 한 번 읽어 user를 바꾼다', async () => {
    const fetch = mockServer(REVOKED);
    useAuth.setState({ status: 'authenticated', user: DONE });
    unbind = bindSignupIncomplete();

    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 403 });
    await flush();

    expect(meCalls(fetch)).toBe(1);
    expect(useAuth.getState().user).toEqual(REVOKED);
  });

  it('이미 가입이 필요한 상태면 /me를 다시 읽지 않는다', async () => {
    const fetch = mockServer(DONE);
    useAuth.setState({ status: 'authenticated', user: REVOKED });
    unbind = bindSignupIncomplete();

    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 403 });
    await flush();

    expect(meCalls(fetch)).toBe(0);
    expect(useAuth.getState().user).toEqual(REVOKED);
  });

  it('해제하면 더 반응하지 않는다', async () => {
    const fetch = mockServer(REVOKED);
    useAuth.setState({ status: 'authenticated', user: DONE });
    bindSignupIncomplete()();

    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 403 });
    await flush();

    expect(meCalls(fetch)).toBe(0);
  });
});
