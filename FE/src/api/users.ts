// 회원 API (설계 3-5).
import type { DataConsent, UserMe } from '@/domain/auth';
import { apiFetch } from './http';

/** `GET /api/users/me`. id는 JSON 숫자 그대로 둔다(BE README FE 소비 계약) */
export function fetchMe(): Promise<UserMe> {
  return apiFetch<UserMe>('/api/users/me');
}

/** `DELETE /api/users/me`(204). 계정·올린 곡·반주를 지우고, 학습 동의한 플레이 기록만 식별 정보를 제거해 보관한다(BE 153) */
export async function withdrawMe(): Promise<void> {
  await apiFetch('/api/users/me', { method: 'DELETE' });
}

/** `PUT /api/users/me/data-consent`(BE 199). agreed·version 둘 다 필수, 200이면 저장된 값 */
export function putDataConsent(body: { agreed: boolean; version: string }): Promise<DataConsent> {
  return apiFetch<DataConsent>('/api/users/me/data-consent', { method: 'PUT', body });
}
