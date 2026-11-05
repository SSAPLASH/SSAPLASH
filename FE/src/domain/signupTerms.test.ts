import { describe, expect, it } from 'vitest';
import {
  SIGNUP_TERMS,
  allAgreed,
  allRequiredAgreed,
  currentConsentVersions,
  dataConsentVersion,
  recommendationVersion,
  termVersion,
  toggleAll,
  toggleOne,
  type SignupTermId,
} from './signupTerms';

const ids = (s: ReadonlySet<SignupTermId>) => [...s].sort();

describe('SIGNUP_TERMS', () => {
  it('이용약관 → 개인정보 → 연주 기록 활용 → 추천 학습 활용 순서이고 앞 셋만 필수', () => {
    expect(SIGNUP_TERMS.map((t) => t.id)).toEqual(['terms', 'privacy', 'dataConsent', 'recommendation']);
    expect(SIGNUP_TERMS.map((t) => t.required)).toEqual([true, true, true, false]);
    for (const t of SIGNUP_TERMS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.body.split('\n').length).toBeGreaterThan(1);
    }
  });

  it('필수 3항목의 판은 그대로다', () => {
    expect(SIGNUP_TERMS.slice(0, 3).map((t) => t.version)).toEqual(['2026-11-02', '2026-11-02', '2026-11-02']);
  });
});

describe('currentConsentVersions', () => {
  it('BE 저장 본문 이름으로 판을 묶고, 체크하지 않은 추천 학습 활용은 agreed false로 싣는다', () => {
    expect(currentConsentVersions()).toEqual({
      termsVersion: SIGNUP_TERMS[0].version,
      privacyVersion: SIGNUP_TERMS[1].version,
      dataConsent: { agreed: true, version: SIGNUP_TERMS[2].version },
      recommendationConsent: { agreed: false, version: SIGNUP_TERMS[3].version },
    });
  });

  it('추천 학습 활용을 체크한 집합이면 agreed true', () => {
    expect(currentConsentVersions(SIGNUP_TERMS, new Set<SignupTermId>(['recommendation'])).recommendationConsent).toEqual({
      agreed: true,
      version: SIGNUP_TERMS[3].version,
    });
  });

  it('필수 항목만 체크한 집합은 agreed false', () => {
    expect(currentConsentVersions(SIGNUP_TERMS, new Set<SignupTermId>(['terms', 'privacy', 'dataConsent'])).recommendationConsent.agreed).toBe(false);
  });

  it('항목이 빠지면 빈 문자열', () => {
    expect(currentConsentVersions([SIGNUP_TERMS[0]])).toEqual({
      termsVersion: SIGNUP_TERMS[0].version,
      privacyVersion: '',
      dataConsent: { agreed: true, version: '' },
      recommendationConsent: { agreed: false, version: '' },
    });
  });
});

describe('recommendationVersion', () => {
  it('추천 학습 활용 항목의 판이며 묶음의 recommendationConsent.version과 같다', () => {
    expect(recommendationVersion()).toBe(SIGNUP_TERMS[3].version);
    expect(recommendationVersion()).toBe(currentConsentVersions().recommendationConsent.version);
    expect(recommendationVersion([])).toBe('');
  });
});

describe('dataConsentVersion', () => {
  it('연주 기록 활용 항목의 판이며 묶음의 dataConsent.version과 같다', () => {
    expect(dataConsentVersion()).toBe(SIGNUP_TERMS[2].version);
    expect(dataConsentVersion()).toBe(currentConsentVersions().dataConsent.version);
  });

  it('항목이 없으면 빈 문자열', () => {
    expect(dataConsentVersion([])).toBe('');
  });
});

describe('allRequiredAgreed · allAgreed', () => {
  it('비어 있으면 둘 다 false, 필수 셋이 있으면 둘 다 true(선택 항목 없이도)', () => {
    expect(allRequiredAgreed(new Set())).toBe(false);
    expect(allAgreed(new Set())).toBe(false);
    const required = new Set<SignupTermId>(['terms', 'privacy', 'dataConsent']);
    expect(allRequiredAgreed(required)).toBe(true);
    expect(allAgreed(required)).toBe(true);
  });

  it('필수가 하나라도 빠지면 false', () => {
    expect(allRequiredAgreed(new Set(['terms', 'privacy']))).toBe(false);
    expect(allAgreed(new Set(['terms', 'privacy', 'recommendation']))).toBe(false);
  });

  it('선택 항목만 켜져 있어도 모두 동의 표시는 꺼져 있다', () => {
    expect(allAgreed(new Set(['recommendation']))).toBe(false);
  });

  it('필수 항목이 없으면 allAgreed는 false', () => {
    expect(allAgreed(new Set(), [])).toBe(false);
  });
});

describe('toggleAll', () => {
  it('필수가 전부 켜져 있지 않으면 필수만 켠다', () => {
    expect(ids(toggleAll(new Set()))).toEqual(['dataConsent', 'privacy', 'terms']);
    expect(ids(toggleAll(new Set(['terms'])))).toEqual(['dataConsent', 'privacy', 'terms']);
  });

  it('필수가 전부 켜져 있으면 필수만 끈다', () => {
    expect(toggleAll(new Set(['terms', 'privacy', 'dataConsent'])).size).toBe(0);
  });

  it('선택 항목은 켜지도 끄지도 않는다', () => {
    expect(ids(toggleAll(new Set()))).not.toContain('recommendation');
    expect(ids(toggleAll(new Set(['terms', 'privacy', 'dataConsent', 'recommendation'])))).toEqual(['recommendation']);
    expect(ids(toggleAll(new Set(['recommendation'])))).toEqual(['dataConsent', 'privacy', 'recommendation', 'terms']);
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

describe('추천 학습 활용 본문', () => {
  it('선택 항목이며 철회·기능 동일 안내와 초안 표시가 있다', () => {
    const t = SIGNUP_TERMS[3];
    expect(t.required).toBe(false);
    expect(t.body).toContain('설정에서 언제든 철회할 수 있어요');
    expect(t.body).toContain('동의하지 않아도 곡 추천을 포함한 모든 기능을 그대로 쓸 수 있어요');
    expect(t.body.split('\n').at(-1)).toBe('(초안 — 약관 담당 검토 후 교체)');
  });
});

describe('termVersion', () => {
  it('항목 id의 판을 돌려준다', () => {
    expect(termVersion('terms')).toBe(SIGNUP_TERMS[0].version);
    expect(termVersion('privacy')).toBe(SIGNUP_TERMS[1].version);
    expect(termVersion('dataConsent')).toBe(SIGNUP_TERMS[2].version);
    expect(termVersion('recommendation')).toBe(SIGNUP_TERMS[3].version);
  });

  it('항목이 없으면 빈 문자열', () => {
    expect(termVersion('privacy', [SIGNUP_TERMS[0]])).toBe('');
  });
});
