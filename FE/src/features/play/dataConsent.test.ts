import { beforeEach, describe, expect, it } from 'vitest';
import { readCurrentConsent } from './dataConsent';
import type { DataConsent, UserMe } from '@/domain/account/auth';
import { dataConsentVersion } from '@/domain/account/signupTerms';
import { resetAuthStoreForTest, useAuth } from '@/store/authStore';

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
  signupCompleted: true,
  consents: { terms: null, privacy: null },
});

beforeEach(() => resetAuthStoreForTest());

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
