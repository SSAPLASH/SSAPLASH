// 추천 곡 R1 API (BE README "곡 추천 R1", 설계 COACH-004-song-recommend-picker 2장). URL·쿼리·본문 모양과 DTO 변환까지만 한다.
// 재시도·시간 초과·숨김 판단은 store가 맡는다.
import { recommendationFromDto, type RecommendationContext, type RecommendationPage } from '@/domain/song/recommendation';
import { apiFetch } from '@/api/http';

export interface FetchRecommendationsParams {
  context: RecommendationContext;
  mode: 'RHYTHM' | 'SHEET';
  /** 1~10, 기본 5 */
  size?: number;
  /** REPORT·DRILL에서만 쿼리에 싣는다. SONG_PICKER에 주면 BE가 400이라 버린다 */
  playId?: string;
}

/** `GET /api/v1/songs/recommendations` */
export async function fetchRecommendations(params: FetchRecommendationsParams, signal?: AbortSignal): Promise<RecommendationPage> {
  const qs = new URLSearchParams({ context: params.context, mode: params.mode });
  if (params.size !== undefined) qs.set('size', String(params.size));
  if ((params.context === 'REPORT' || params.context === 'DRILL') && params.playId) qs.set('playId', params.playId);
  const body = await apiFetch<{ requestId?: unknown; strategy?: unknown; items?: Record<string, unknown>[] }>(
    `/api/v1/songs/recommendations?${qs}`,
    { signal },
  );
  return {
    requestId: String(body.requestId ?? ''),
    strategy: String(body.strategy ?? ''),
    items: (body.items ?? []).map(recommendationFromDto),
  };
}

/** `POST /api/v1/recommendations/{requestId}/clicks` — 204. 실패(404 포함)는 ApiError로 던지고 삼키는 것은 호출자 몫 */
export async function postRecommendationClick(requestId: string, songId: number): Promise<void> {
  await apiFetch(`/api/v1/recommendations/${encodeURIComponent(requestId)}/clicks`, { method: 'POST', body: { songId } });
}
