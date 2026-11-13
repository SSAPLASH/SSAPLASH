// 비슷한 곡 R2 API (BE README "비슷한 곡 R2", 설계 COACH-004-similar-songs 2장). URL·쿼리와 DTO 변환까지만 한다.
// 시간 초과·숨김 판단은 store가 맡는다. 404 SONG_NOT_FOUND는 ApiError로 던진다.
import type { Difficulty } from '@/domain/song/chart';
import { similarFromDto, type SimilarPage } from '@/domain/song/recommendation';
import { apiFetch } from '@/api/http';

export interface FetchSimilarParams {
  /** 기준 연습 단계. 기본은 BE가 NORMAL로 본다 */
  difficulty?: Difficulty;
  /** 1~10, 기본 5 */
  size?: number;
}

/** `GET /api/v1/songs/{songId}/similar` */
export async function fetchSimilarSongs(songId: number, params: FetchSimilarParams = {}, signal?: AbortSignal): Promise<SimilarPage> {
  const qs = new URLSearchParams();
  if (params.difficulty !== undefined) qs.set('difficulty', params.difficulty);
  if (params.size !== undefined) qs.set('size', String(params.size));
  const query = qs.size > 0 ? `?${qs}` : '';
  const body = await apiFetch<{ requestId?: unknown; strategy?: unknown; items?: Record<string, unknown>[] }>(
    `/api/v1/songs/${encodeURIComponent(String(songId))}/similar${query}`,
    { signal },
  );
  return {
    requestId: String(body.requestId ?? ''),
    strategy: String(body.strategy ?? ''),
    items: (body.items ?? []).map(similarFromDto),
  };
}
