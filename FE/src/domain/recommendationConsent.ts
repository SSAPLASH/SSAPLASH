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

/** 한 번도 답하지 않았는가(= 기존 사용자 안내 대상). 읽지 못했거나 아직 안 읽었으면(null) 안내하지 않는다 */
export function needsRecommendationPrompt(c: RecommendationConsent | null | undefined): boolean {
  return c != null && c.version === null;
}

/** 동의했지만 판이 지금과 다른가(약관 개정). 설정에서 "다시 켜면 새 판에 동의해요" 안내를 보인다 */
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

/** 설정 상태 줄: 현재 판에 동의했으면 "동의함 · {판} 판 · {MM/DD} 변경", 그 밖(미응답·거부·판 불일치·읽기 실패)은 "미동의" */
export function consentStatusText(c: RecommendationConsent | null | undefined, version: string = recommendationVersion()): string {
  if (!isRecommendationConsentCurrent(c, version) || c == null) return '미동의';
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
