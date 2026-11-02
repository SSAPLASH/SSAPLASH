import { describe, expect, it } from 'vitest';
import {
  SIGNUP_TERMS,
  allAgreed,
  allRequiredAgreed,
  currentConsentVersions,
  dataConsentVersion,
  toggleAll,
  toggleOne,
  type SignupTerm,
  type SignupTermId,
} from './signupTerms';

const ids = (s: ReadonlySet<SignupTermId>) => [...s].sort();

describe('SIGNUP_TERMS', () => {
  it('이용약관 → 개인정보 → 연주 기록 활용 순서로 세 항목이며 1단계는 전부 필수', () => {
    expect(SIGNUP_TERMS.map((t) => t.id)).toEqual(['terms', 'privacy', 'dataConsent']);
    for (const t of SIGNUP_TERMS) {
      expect(t.required).toBe(true);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.body.split('\n').length).toBeGreaterThan(1);
    }
  });
});

describe('currentConsentVersions', () => {
  it('BE 저장 본문 이름으로 판을 묶는다', () => {
    expect(currentConsentVersions()).toEqual({
      termsVersion: SIGNUP_TERMS[0].version,
      privacyVersion: SIGNUP_TERMS[1].version,
      dataConsentVersion: SIGNUP_TERMS[2].version,
    });
  });

  it('항목이 빠지면 빈 문자열', () => {
    expect(currentConsentVersions([SIGNUP_TERMS[0]])).toEqual({ termsVersion: SIGNUP_TERMS[0].version, privacyVersion: '', dataConsentVersion: '' });
  });
});

describe('dataConsentVersion', () => {
  it('연주 기록 활용 항목의 판이며 묶음의 dataConsentVersion과 같다', () => {
    expect(dataConsentVersion()).toBe(SIGNUP_TERMS[2].version);
    expect(dataConsentVersion()).toBe(currentConsentVersions().dataConsentVersion);
  });

  it('항목이 없으면 빈 문자열', () => {
    expect(dataConsentVersion([])).toBe('');
  });
});

describe('allRequiredAgreed · allAgreed', () => {
  it('비어 있으면 둘 다 false, 셋 다 있으면 둘 다 true', () => {
    expect(allRequiredAgreed(new Set())).toBe(false);
    expect(allAgreed(new Set())).toBe(false);
    const all = new Set<SignupTermId>(['terms', 'privacy', 'dataConsent']);
    expect(allRequiredAgreed(all)).toBe(true);
    expect(allAgreed(all)).toBe(true);
  });

  it('하나라도 빠지면 false', () => {
    expect(allRequiredAgreed(new Set(['terms', 'privacy']))).toBe(false);
  });

  it('선택 항목은 필수 판정에서 빠지지만 모두 동의 표시에는 들어간다', () => {
    const terms: SignupTerm[] = SIGNUP_TERMS.map((t) => (t.id === 'dataConsent' ? { ...t, required: false } : t));
    const requiredOnly = new Set<SignupTermId>(['terms', 'privacy']);
    expect(allRequiredAgreed(requiredOnly, terms)).toBe(true);
    expect(allAgreed(requiredOnly, terms)).toBe(false);
  });

  it('항목이 없으면 allAgreed는 false', () => {
    expect(allAgreed(new Set(), [])).toBe(false);
  });
});

describe('toggleAll', () => {
  it('전부 켜져 있지 않으면 전부 켠다', () => {
    expect(ids(toggleAll(new Set()))).toEqual(['dataConsent', 'privacy', 'terms']);
    expect(ids(toggleAll(new Set(['terms'])))).toEqual(['dataConsent', 'privacy', 'terms']);
  });

  it('전부 켜져 있으면 전부 끈다', () => {
    expect(toggleAll(new Set(['terms', 'privacy', 'dataConsent'])).size).toBe(0);
  });
});

describe('toggleOne', () => {
  it('없으면 넣고 있으면 빼며 원본은 바꾸지 않는다', () => {
    const base = new Set<SignupTermId>(['terms']);
    const added = toggleOne(base, 'privacy');
    expect(ids(added)).toEqual(['privacy', 'terms']);
    expect(ids(toggleOne(added, 'terms'))).toEqual(['privacy']);
    expect(ids(base)).toEqual(['terms']);
  });
});

describe('연주 기록 활용 본문', () => {
  it('필수 항목이며 철회는 탈퇴로만 한다는 줄이 있다', () => {
    const t = SIGNUP_TERMS[2];
    expect(t.required).toBe(true);
    expect(t.body).toContain('동의 철회는 회원 탈퇴로 할 수 있어요.');
  });
});
