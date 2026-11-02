import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from './auth';
import { postSignupConsent } from './users';
import type { UserMe } from '@/domain/auth';
import { currentConsentVersions } from '@/domain/signupTerms';

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
