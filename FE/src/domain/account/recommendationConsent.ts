// 맞춤 곡 추천 학습 활용 동의의 순수 규칙 (설계 COACH-004-recommendation-consent D5·D7).
// 서버 값이 지금 판에 동의한 것인지, 기존 사용자에게 안내가 필요한지, 설정 상태 줄 문구만 정한다.
// 가입 게이트(signupGate)는 이 판단을 쓰지 않는다 — 선택 항목의 판 변경이 가입을 막으면 안 된다. React·fetch·store에 의존하지 않는다.
import { SIGNUP_CONSENT_VERSION_INVALID } from './auth';
import { recommendationVersion } from './signupTerms';

/** `GET`·`PUT /api/users/me/recommendation-consent` 응답. 응답한 적 없으면 agreed=false, version·updatedAt=null */
export interface RecommendationConsent {
  agreed: boolean;
  version: string | null;
  updatedAt: string | null;
}

/** 서버 값이 현재 판에 동의한 상태인가. 없음·null·거부·판 불일치는 모두 false */
export function isRecommendationConsentCurrent(c: RecommendationConsent | null | undefined, version: string = recommendationVersion()): boolean {
  return c?.agreed === true && c.version === version;
}

/**
 * 수집이 꺼진 초안 판. 이 기간에는 가입 화면에 추천 항목이 없었는데도 가입 요청이 "거부, 이 판"을 함께 저장했다.
 * 그래서 이 판의 거부는 사용자가 본문을 보고 고른 답이 아니므로 한 번 다시 묻는다.
 */
export const DRAFT_RECOMMENDATION_VERSION = '2026-11-05';

/**
 * 안내 창을 띄울 대상인가: 한 번도 답하지 않았거나(version null), 초안 판에 자동으로 거부가 저장된 경우.
 * 공개 판 이후에 거부한 사람은 판이 바뀌어도 다시 묻지 않는다. 읽지 못했거나 아직 안 읽었으면(null) 안내하지 않는다
 */
export function needsRecommendationPrompt(c: RecommendationConsent | null | undefined): boolean {
  if (c == null) return false;
  return c.version === null || (c.agreed === false && c.version === DRAFT_RECOMMENDATION_VERSION);
}

/** 동의했지만 판이 지금과 다른가(약관 개정). 설정에서 새 본문 확인과 동의 여부를 별도로 안내한다 */
export function isRecommendationVersionStale(c: RecommendationConsent | null | undefined, version: string = recommendationVersion()): boolean {
  return c?.agreed === true && c.version !== null && c.version !== version;
}

/** 변경 시각(ISO)을 "MM/DD"로. 해석할 수 없으면 null */
function shortDate(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** 설정 상태 줄: 현재 판에 동의했으면 "동의함 · {판} 판 · {MM/DD} 변경", 미응답·거부는 "미동의", 판 불일치와 읽기 실패는 별도 안내 */
export function consentStatusText(c: RecommendationConsent | null | undefined, version: string = recommendationVersion()): string {
  if (c == null) return '동의 상태를 확인할 수 없어요';
  if (isRecommendationVersionStale(c, version)) return `이전 판에 동의함 · ${c.version} 판 · 새 동의 내용 확인 필요`;
  if (!isRecommendationConsentCurrent(c, version)) return '미동의';
  const date = shortDate(c.updatedAt);
  return date === null ? `동의함 · ${version} 판` : `동의함 · ${version} 판 · ${date} 변경`;
}

/**
 * 설정에서 동의 저장(PUT)이 실패했을 때의 문구(설계 D8). 페이지가 api를 import하지 않도록 오류를 구조(`code`)로 읽는다.
 * 판 불일치(422)는 새로고침을 안내하고, 그 밖은 다시 시도를 안내한다.
 */
export function consentSaveErrorMessage(e: unknown): string {
  const code = e instanceof Error ? (e as { code?: unknown }).code : undefined;
  if (code === SIGNUP_CONSENT_VERSION_INVALID) return '약관이 갱신되었어요. 새로고침한 뒤 다시 시도해 주세요.';
  return '저장하지 못했어요. 다시 시도해 주세요.';
}
