import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from './auth';
import { getRecommendationConsent, postSignupConsent, putRecommendationConsent } from './users';
import type { UserMe } from '@/domain/account/auth';
import { currentConsentVersions } from '@/domain/account/signupTerms';

const ME: UserMe = {
  id: 7,
  provider: 'GOOGLE',
  nickname: '원빈',
  profileImageUrl: null,
  role: 'USER',
  createdAt: '2026-10-20T03:00:00Z',
  updatedAt: '2026-10-20T03:00:00Z',
  dataConsent: { agreed: true, version: '2026-11-02', updatedAt: '2026-11-02T01:00:00Z' },
  signupCompleted: true,
  consents: {
    terms: { version: '2026-11-02', agreedAt: '2026-11-02T01:00:00Z' },
    privacy: { version: '2026-11-02', agreedAt: '2026-11-02T01:00:00Z' },
  },
};

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('postSignupConsent', () => {
  it('POST /api/users/me/signup-consent에 판 묶음을 JSON으로 보내고 /me 본문을 돌려준다', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(ME), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);

    const body = currentConsentVersions();
    const user = await postSignupConsent(body);

    expect(user).toEqual(ME);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/users/me/signup-consent');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('postSignupConsent 추천 학습 본문', () => {
  it('recommendationConsent를 항상 싣는다', async () => {
    const fetch = vi.fn(async () => json(ME));
    vi.stubGlobal('fetch', fetch);
    await postSignupConsent(currentConsentVersions());
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).recommendationConsent).toEqual({ agreed: false, version: '2026-11-11' });
  });
});

describe('getRecommendationConsent', () => {
  it('GET /api/users/me/recommendation-consent 응답을 그대로 돌려준다', async () => {
    const fetch = vi.fn(async () => json({ agreed: true, version: '2026-11-05', updatedAt: '2026-11-05T01:00:00Z' }));
    vi.stubGlobal('fetch', fetch);
    expect(await getRecommendationConsent()).toEqual({ agreed: true, version: '2026-11-05', updatedAt: '2026-11-05T01:00:00Z' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/users/me/recommendation-consent');
    expect(init.method).toBe('GET');
  });

  it('응답한 적 없으면 version·updatedAt이 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ agreed: false, version: null, updatedAt: null })));
    expect(await getRecommendationConsent()).toEqual({ agreed: false, version: null, updatedAt: null });
  });

  it('필드가 빠져도 미응답 모양으로 채운다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    expect(await getRecommendationConsent()).toEqual({ agreed: false, version: null, updatedAt: null });
  });
});

describe('putRecommendationConsent', () => {
  it('PUT으로 { agreed, version }을 JSON으로 보내고 응답을 돌려준다', async () => {
    const fetch = vi.fn(async () => json({ agreed: false, version: '2026-11-05', updatedAt: '2026-11-05T02:00:00Z' }));
    vi.stubGlobal('fetch', fetch);
    const r = await putRecommendationConsent({ agreed: false, version: '2026-11-05' });
    expect(r).toEqual({ agreed: false, version: '2026-11-05', updatedAt: '2026-11-05T02:00:00Z' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/users/me/recommendation-consent');
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ agreed: false, version: '2026-11-05' });
  });
});
