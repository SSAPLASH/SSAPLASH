// 회원 API (설계 3-5).
import type { UserMe } from '@/domain/account/auth';
import type { RecommendationConsent } from '@/domain/account/recommendationConsent';
import type { ConsentVersions } from '@/domain/account/signupTerms';
import { apiFetch } from '@/api/http';

/** `GET /api/users/me`. id는 JSON 숫자 그대로 둔다(BE README FE 소비 계약) */
export function fetchMe(): Promise<UserMe> {
  return apiFetch<UserMe>('/api/users/me');
}

/** `DELETE /api/users/me`(204). 계정·올린 곡·반주를 지우고, 학습 동의한 플레이 기록만 식별 정보를 제거해 보관한다(BE 153) */
export async function withdrawMe(): Promise<void> {
  await apiFetch('/api/users/me', { method: 'DELETE' });
}

/** `POST /api/users/me/signup-consent`. 응답 200은 `/me` 본문 그대로다(이미 가입한 회원의 재동의도 200). 오류는 ApiError (메일 ACCT-001 회신) */
export function postSignupConsent(body: ConsentVersions): Promise<UserMe> {
  return apiFetch<UserMe>('/api/users/me/signup-consent', { method: 'POST', body });
}

/** `GET /api/users/me/recommendation-consent`. 응답한 적 없으면 `agreed=false`, `version`·`updatedAt`은 null (BE README 곡 추천 R3) */
export async function getRecommendationConsent(): Promise<RecommendationConsent> {
  return toRecommendationConsent(await apiFetch<Partial<RecommendationConsent>>('/api/users/me/recommendation-consent'));
}

/** `PUT /api/users/me/recommendation-consent`. `agreed=false`여도 `version`이 필요하다. 판이 허용 목록에 없으면 422 SIGNUP_CONSENT_VERSION_INVALID */
export async function putRecommendationConsent(body: { agreed: boolean; version: string }): Promise<RecommendationConsent> {
  return toRecommendationConsent(await apiFetch<Partial<RecommendationConsent>>('/api/users/me/recommendation-consent', { method: 'PUT', body }));
}

/** 응답 필드가 빠져도 미응답 모양으로 채운다 */
function toRecommendationConsent(r: Partial<RecommendationConsent> | null | undefined): RecommendationConsent {
  return { agreed: r?.agreed === true, version: r?.version ?? null, updatedAt: r?.updatedAt ?? null };
}
