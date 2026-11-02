import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindLegacyConsentUpload, readCurrentConsent } from './dataConsent';
import { resetForTest } from '@/api/auth';
import type { DataConsent, UserMe } from '@/domain/auth';
import { dataConsentVersion } from '@/domain/signupTerms';
import { resetAuthStoreForTest, useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';

const NONE: DataConsent = { agreed: null, version: null, updatedAt: null };
const SAVED: DataConsent = { agreed: true, version: dataConsentVersion(), updatedAt: '2026-11-02T01:00:00Z' };

const me = (dataConsent: DataConsent): UserMe => ({
  id: 3,
  provider: 'GOOGLE',
  nickname: '곰',
  profileImageUrl: null,
  role: 'USER',
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
  dataConsent,
});

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

function mockFetch(handler: () => Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => handler());
  vi.stubGlobal('fetch', fn);
  return fn;
}

let unbind: (() => void) | null = null;
let savedStats: boolean;

beforeEach(() => {
  resetForTest();
  resetAuthStoreForTest();
  savedStats = useSettings.getState().statsConsent;
  useSettings.setState({ statsConsent: false });
});
afterEach(() => {
  unbind?.();
  unbind = null;
  useSettings.setState({ statsConsent: savedStats });
  vi.unstubAllGlobals();
});

/** 비로그인에서 묶고 로그인 전이를 일으킨다 */
function loginWith(dc: DataConsent): void {
  unbind = bindLegacyConsentUpload();
  useAuth.setState({ status: 'authenticated', user: me(dc) });
}

describe('readCurrentConsent', () => {
  it('비로그인이면 false', () => {
    expect(readCurrentConsent()).toBe(false);
  });

  it('로그인 + 현재 판 동의면 true', () => {
    useAuth.setState({ status: 'authenticated', user: me(SAVED) });
    expect(readCurrentConsent()).toBe(true);
  });

  it('판이 다르거나 답한 적 없으면 false', () => {
    useAuth.setState({ status: 'authenticated', user: me({ ...SAVED, version: '1999-01-01' }) });
    expect(readCurrentConsent()).toBe(false);
    useAuth.setState({ user: me(NONE) });
    expect(readCurrentConsent()).toBe(false);
  });
});

describe('bindLegacyConsentUpload', () => {
  it('서버가 답한 적 없고 브라우저 true면 PUT 한 번 뒤 브라우저 값을 비운다', async () => {
    useSettings.setState({ statsConsent: true });
    const fn = mockFetch(() => json(200, SAVED));
    loginWith(NONE);
    await vi.waitFor(() => expect(useSettings.getState().statsConsent).toBe(false));
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/users/me/data-consent');
    expect(JSON.parse(String(init?.body))).toEqual({ agreed: true, version: dataConsentVersion() });
    expect(useAuth.getState().user?.dataConsent).toEqual(SAVED);
  });

  it('서버에 값이 있고 브라우저 true면 올리지 않고 비운다', () => {
    useSettings.setState({ statsConsent: true });
    const fn = mockFetch(() => json(200, SAVED));
    loginWith({ ...SAVED, agreed: false });
    expect(fn).not.toHaveBeenCalled();
    expect(useSettings.getState().statsConsent).toBe(false);
  });

  it('브라우저 false면 아무것도 하지 않는다', () => {
    const fn = mockFetch(() => json(200, SAVED));
    loginWith(NONE);
    expect(fn).not.toHaveBeenCalled();
    expect(useSettings.getState().statsConsent).toBe(false);
  });

  it('PUT이 실패하면 브라우저 값을 그대로 둔다', async () => {
    useSettings.setState({ statsConsent: true });
    const fn = mockFetch(() => json(500, { status: 500, code: 'INTERNAL_ERROR', detail: 'x' }, 'application/problem+json'));
    loginWith(NONE);
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    // 실패 처리(then의 거부 분기)가 끝날 때까지 한 틱 더 기다린다
    await new Promise((r) => setTimeout(r, 0));
    expect(useSettings.getState().statsConsent).toBe(true);
  });

  it('authenticated 전이에서만 돈다(같은 로그인의 다른 상태 변화는 무시)', async () => {
    useSettings.setState({ statsConsent: true });
    const fn = mockFetch(() => json(200, SAVED));
    loginWith(NONE);
    await vi.waitFor(() => expect(useSettings.getState().statsConsent).toBe(false));
    expect(fn).toHaveBeenCalledTimes(1);

    // 브라우저 값을 다시 켜도, 로그인 상태가 유지되는 동안 user가 바뀌는 것만으로는 다시 돌지 않는다
    useSettings.setState({ statsConsent: true });
    useAuth.setState({ user: me(NONE) });
    useAuth.setState({ lostReason: null });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(useSettings.getState().statsConsent).toBe(true);
  });

  it('묶을 때 이미 로그인 상태면 그때 한 번 처리한다', () => {
    useSettings.setState({ statsConsent: true });
    useAuth.setState({ status: 'authenticated', user: me({ ...SAVED, agreed: false }) });
    mockFetch(() => json(200, SAVED));
    unbind = bindLegacyConsentUpload();
    expect(useSettings.getState().statsConsent).toBe(false);
  });
});
