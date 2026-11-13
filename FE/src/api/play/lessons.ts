// 입문 코스 레슨 (BE 331 `/api/v1/lessons`). 응답 검증·정렬은 domain/play/lesson이 맡는다.
import { lessonsFromDto, type LessonList } from '@/domain/play/lesson';
import { apiFetch } from '@/api/http';

export async function fetchLessons(signal?: AbortSignal): Promise<LessonList> {
  return lessonsFromDto(await apiFetch<unknown>('/api/v1/lessons', { signal }));
}

/** 알아보기 레슨 완료 저장. 이미 완료했어도 성공(204)이다 */
export function postLessonCompletion(songId: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(songId) || songId <= 0) return Promise.reject(new Error('레슨 곡 ID가 올바르지 않습니다.'));
  return apiFetch<void>(`/api/v1/lessons/${songId}/completion`, { method: 'POST', signal });
}
