import { describe, expect, it } from 'vitest';
import type { UserMe } from './auth';
import { needsSignup, signupGateDecision } from './signupGate';
import { termVersion } from './signupTerms';

const NOW = '2026-11-02T01:00:00Z';

/** 가입이 끝난 회원. 판은 현재 판 */
function member(patch: Partial<UserMe> = {}): UserMe {
  return {
    id: 1,
    provider: 'GOOGLE',
    nickname: '곰',
    profileImageUrl: null,
    role: 'USER',
    createdAt: NOW,
    updatedAt: NOW,
    dataConsent: { agreed: true, version: termVersion('dataConsent'), updatedAt: NOW },
    signupCompleted: true,
    consents: {
      terms: { version: termVersion('terms'), agreedAt: NOW },
      privacy: { version: termVersion('privacy'), agreedAt: NOW },
    },
    ...patch,
  };
}

describe('needsSignup', () => {
  it('회원이 없으면 false', () => {
    expect(needsSignup(null)).toBe(false);
    expect(needsSignup(undefined)).toBe(false);
  });

  it('signupCompleted가 false면 true', () => {
    expect(needsSignup(member({ signupCompleted: false }))).toBe(true);
  });

  it('이용약관 판이 다르면 true', () => {
    expect(needsSignup(member({ consents: { terms: { version: '2020-01-01', agreedAt: NOW }, privacy: member().consents.privacy } }))).toBe(true);
  });

  it('개인정보 판이 다르면 true', () => {
    expect(needsSignup(member({ consents: { terms: member().consents.terms, privacy: { version: '2020-01-01', agreedAt: NOW } } }))).toBe(true);
  });

  it('연주 기록 활용 동의가 현재 판이 아니면 true (null·거부·옛 판)', () => {
    expect(needsSignup(member({ dataConsent: { agreed: null, version: null, updatedAt: null } }))).toBe(true);
    expect(needsSignup(member({ dataConsent: { agreed: false, version: termVersion('dataConsent'), updatedAt: NOW } }))).toBe(true);
    expect(needsSignup(member({ dataConsent: { agreed: true, version: '2020-01-01', updatedAt: NOW } }))).toBe(true);
  });

  it('전부 현재 판이면 false', () => {
    expect(needsSignup(member())).toBe(false);
  });

  it('signupCompleted 필드가 없는 응답(BE 미병합)은 dataConsent가 없거나 비어 있어도 false (D28)', () => {
    const legacy = member() as Partial<UserMe>;
    delete legacy.signupCompleted;
    delete legacy.consents;
    delete legacy.dataConsent;
    expect(needsSignup(legacy as UserMe)).toBe(false);
    const nullConsent = { ...member(), dataConsent: { agreed: null, version: null, updatedAt: null } } as Partial<UserMe>;
    delete nullConsent.signupCompleted;
    expect(needsSignup(nullConsent as UserMe)).toBe(false);
  });
});

describe('signupGateDecision', () => {
  it('검사를 끄면 상태와 상관없이 pass', () => {
    expect(signupGateDecision({ required: false, status: 'anonymous', user: null })).toBe('pass');
    expect(signupGateDecision({ required: false, status: 'unknown', user: null })).toBe('pass');
  });

  it('unknown·restoring은 wait', () => {
    expect(signupGateDecision({ required: true, status: 'unknown', user: null })).toBe('wait');
    expect(signupGateDecision({ required: true, status: 'restoring', user: null })).toBe('wait');
  });

  it('anonymous는 login', () => {
    expect(signupGateDecision({ required: true, status: 'anonymous', user: null })).toBe('login');
  });

  it('로그인했고 가입이 필요하면 signup', () => {
    expect(signupGateDecision({ required: true, status: 'authenticated', user: member({ signupCompleted: false }) })).toBe('signup');
  });

  it('로그인했고 가입이 끝났으면 done', () => {
    expect(signupGateDecision({ required: true, status: 'authenticated', user: member() })).toBe('done');
  });
});
