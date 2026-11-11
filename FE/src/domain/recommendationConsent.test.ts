import { describe, expect, it } from 'vitest';
import {
  consentSaveErrorMessage,
  consentStatusText,
  isRecommendationConsentCurrent,
  isRecommendationVersionStale,
  DRAFT_RECOMMENDATION_VERSION,
  needsRecommendationPrompt,
  type RecommendationConsent,
} from './recommendationConsent';
import { recommendationVersion } from './signupTerms';

const V = recommendationVersion();
const c = (over: Partial<RecommendationConsent> = {}): RecommendationConsent => ({ agreed: true, version: V, updatedAt: '2026-11-05T12:00:00Z', ...over });

describe('isRecommendationConsentCurrent', () => {
  it('동의했고 판이 같을 때만 true', () => {
    expect(isRecommendationConsentCurrent(c())).toBe(true);
  });

  it('null·undefined·거부·판 불일치·미응답은 false', () => {
    expect(isRecommendationConsentCurrent(null)).toBe(false);
    expect(isRecommendationConsentCurrent(undefined)).toBe(false);
    expect(isRecommendationConsentCurrent(c({ agreed: false }))).toBe(false);
    expect(isRecommendationConsentCurrent(c({ version: '2026-01-01' }))).toBe(false);
    expect(isRecommendationConsentCurrent({ agreed: false, version: null, updatedAt: null })).toBe(false);
  });

  it('비교할 판을 넘길 수 있다', () => {
    expect(isRecommendationConsentCurrent(c({ version: 'x' }), 'x')).toBe(true);
  });
});

describe('needsRecommendationPrompt', () => {
  it('version이 null(한 번도 답하지 않음)이면 true', () => {
    expect(needsRecommendationPrompt({ agreed: false, version: null, updatedAt: null })).toBe(true);
  });

  it('동의·거부 응답이 있으면 false (판이 달라도 다시 묻지 않는다)', () => {
    expect(needsRecommendationPrompt(c())).toBe(false);
    expect(needsRecommendationPrompt(c({ agreed: false }))).toBe(false);
    expect(needsRecommendationPrompt(c({ version: '2026-01-01' }))).toBe(false);
    expect(needsRecommendationPrompt(c({ agreed: false, version: '2026-01-01' }))).toBe(false);
  });

  it('초안 판에 자동 저장된 거부는 한 번 다시 묻는다', () => {
    expect(DRAFT_RECOMMENDATION_VERSION).not.toBe(V);
    expect(needsRecommendationPrompt(c({ agreed: false, version: DRAFT_RECOMMENDATION_VERSION }))).toBe(true);
    // 초안 판에 동의한 경우는 판 불일치(isRecommendationVersionStale)로 따로 안내한다
    expect(needsRecommendationPrompt(c({ agreed: true, version: DRAFT_RECOMMENDATION_VERSION }))).toBe(false);
  });

  it('아직 읽지 못했거나 읽기 실패(null)면 false', () => {
    expect(needsRecommendationPrompt(null)).toBe(false);
    expect(needsRecommendationPrompt(undefined)).toBe(false);
  });
});

describe('isRecommendationVersionStale', () => {
  it('동의했지만 판이 다를 때만 true', () => {
    expect(isRecommendationVersionStale(c({ version: '2026-01-01' }))).toBe(true);
    expect(isRecommendationVersionStale(c())).toBe(false);
    expect(isRecommendationVersionStale(c({ agreed: false, version: '2026-01-01' }))).toBe(false);
    expect(isRecommendationVersionStale(null)).toBe(false);
  });
});

describe('consentStatusText', () => {
  it('현재 판에 동의했으면 판과 변경일', () => {
    expect(consentStatusText(c())).toBe(`동의함 · ${V} 판 · 11/05 변경`);
  });

  it('변경 시각이 없거나 깨졌으면 날짜를 뺀다', () => {
    expect(consentStatusText(c({ updatedAt: null }))).toBe(`동의함 · ${V} 판`);
    expect(consentStatusText(c({ updatedAt: 'x' }))).toBe(`동의함 · ${V} 판`);
  });

  it('미응답·거부·판 불일치·null은 미동의', () => {
    expect(consentStatusText({ agreed: false, version: null, updatedAt: null })).toBe('미동의');
    expect(consentStatusText(c({ agreed: false }))).toBe('미동의');
    expect(consentStatusText(c({ version: '2026-01-01' }))).toBe('이전 판에 동의함 · 2026-01-01 판 · 새 동의 내용 확인 필요');
    expect(consentStatusText(null)).toBe('동의 상태를 확인할 수 없어요');
  });
});

describe('consentSaveErrorMessage', () => {
  it('판 불일치 코드는 새로고침 안내', () => {
    const e = Object.assign(new Error('x'), { code: 'SIGNUP_CONSENT_VERSION_INVALID' });
    expect(consentSaveErrorMessage(e)).toBe('약관이 갱신되었어요. 새로고침한 뒤 다시 시도해 주세요.');
  });

  it('그 밖의 오류는 다시 시도 안내', () => {
    expect(consentSaveErrorMessage(Object.assign(new Error('x'), { code: 'NETWORK' }))).toBe('저장하지 못했어요. 다시 시도해 주세요.');
    expect(consentSaveErrorMessage('문자열')).toBe('저장하지 못했어요. 다시 시도해 주세요.');
  });
});
