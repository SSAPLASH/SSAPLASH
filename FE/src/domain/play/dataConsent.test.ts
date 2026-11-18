import { describe, expect, it } from 'vitest';
import type { DataConsent } from '@/domain/account/auth';
import { isConsentCurrent, logConsent } from './dataConsent';
import { dataConsentVersion } from '@/domain/account/signupTerms';

const dc = (agreed: boolean | null, version: string | null): DataConsent => ({
  agreed,
  version,
  updatedAt: agreed === null ? null : '2026-11-02T00:00:00Z',
});

describe('isConsentCurrent', () => {
  it('없음·null·답한 적 없음은 false', () => {
    expect(isConsentCurrent(undefined)).toBe(false);
    expect(isConsentCurrent(null)).toBe(false);
    expect(isConsentCurrent(dc(null, null))).toBe(false);
  });

  it('거부(false)는 판이 같아도 false', () => {
    expect(isConsentCurrent(dc(false, dataConsentVersion()))).toBe(false);
  });

  it('동의했어도 판이 다르면 false', () => {
    expect(isConsentCurrent(dc(true, '1999-01-01'))).toBe(false);
  });

  it('동의 + 현재 판이면 true', () => {
    expect(isConsentCurrent(dc(true, dataConsentVersion()))).toBe(true);
  });

  it('비교할 판을 직접 줄 수 있다', () => {
    expect(isConsentCurrent(dc(true, 'v9'), 'v9')).toBe(true);
    expect(isConsentCurrent(dc(true, 'v9'), 'v8')).toBe(false);
  });
});

describe('logConsent', () => {
  it('필드가 없거나 false면 false, true면 true', () => {
    expect(logConsent({})).toBe(false);
    expect(logConsent({ consent: false })).toBe(false);
    expect(logConsent({ consent: true })).toBe(true);
  });
});
