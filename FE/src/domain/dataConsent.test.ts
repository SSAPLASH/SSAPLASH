import { describe, expect, it } from 'vitest';
import type { DataConsent } from './auth';
import { isConsentCurrent, legacyConsentAction, logConsent } from './dataConsent';
import { dataConsentVersion } from './signupTerms';

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

describe('legacyConsentAction', () => {
  it('브라우저 값이 false면 서버 값과 상관없이 none', () => {
    expect(legacyConsentAction(undefined, false)).toBe('none');
    expect(legacyConsentAction(dc(null, null), false)).toBe('none');
    expect(legacyConsentAction(dc(true, 'v'), false)).toBe('none');
  });

  it('브라우저 true + 서버가 없거나 답한 적 없으면 upload', () => {
    expect(legacyConsentAction(undefined, true)).toBe('upload');
    expect(legacyConsentAction(null, true)).toBe('upload');
    expect(legacyConsentAction(dc(null, null), true)).toBe('upload');
  });

  it('브라우저 true + 서버에 값이 있으면 덮지 않고 clear', () => {
    expect(legacyConsentAction(dc(true, dataConsentVersion()), true)).toBe('clear');
    expect(legacyConsentAction(dc(false, dataConsentVersion()), true)).toBe('clear');
  });
});

describe('logConsent', () => {
  it('필드가 없거나 false면 false, true면 true', () => {
    expect(logConsent({})).toBe(false);
    expect(logConsent({ consent: false })).toBe(false);
    expect(logConsent({ consent: true })).toBe(true);
  });
});
