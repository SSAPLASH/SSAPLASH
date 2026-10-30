// 회원 API (설계 3-5).
import type { UserMe } from '@/domain/auth';
import { apiFetch } from './http';

/** `GET /api/users/me`. id는 JSON 숫자 그대로 둔다(BE README FE 소비 계약) */
export function fetchMe(): Promise<UserMe> {
  return apiFetch<UserMe>('/api/users/me');
}

/** `DELETE /api/users/me`(204). 계정·올린 곡·반주를 지우고, 학습 동의한 플레이 기록만 식별 정보를 제거해 보관한다(BE 153) */
export async function withdrawMe(): Promise<void> {
  await apiFetch('/api/users/me', { method: 'DELETE' });
}
