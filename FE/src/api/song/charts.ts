// 채보 API (BE 96, 설계 3-1). DTO를 그대로 돌려준다 — 변환은 domain/song/chartMapping.
import type { ChartAssetsDto, ChartDetailDto } from '@/domain/song/chartMapping';
import { apiFetch } from '@/api/http';

/** `GET /api/v1/charts/{chartId}` — 최신 버전. 곡 선택 직후 1회만 쓴다 */
export function getChartLatest(chartId: number, signal?: AbortSignal): Promise<ChartDetailDto> {
  return apiFetch<ChartDetailDto>(`/api/v1/charts/${chartId}`, { signal });
}

/** `GET /api/v1/chart-versions/{id}/assets` — 서명 URL 발급·갱신 */
export function getChartAssets(chartVersionId: number, signal?: AbortSignal): Promise<ChartAssetsDto> {
  return apiFetch<ChartAssetsDto>(`/api/v1/chart-versions/${chartVersionId}/assets`, { signal });
}
