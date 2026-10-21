// 회원 API (설계 3-5).
import type { UserMe } from '@/domain/auth';
import { apiFetch } from './http';

/** `GET /api/users/me`. id는 JSON 숫자 그대로 둔다(BE README FE 소비 계약) */
export function fetchMe(): Promise<UserMe> {
  return apiFetch<UserMe>('/api/users/me');
}
