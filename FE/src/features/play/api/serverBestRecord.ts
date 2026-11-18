import type { BestRecordDto } from '@/api/play/plays';

export type BestRecordMode = 'RHYTHM' | 'SHEET';

/** 서버의 단계별 집계를 화면별로 선택한다. 점수와 정확도는 독립된 최고값이다. */
export function selectServerBestRecords(items: readonly BestRecordDto[], songIds: readonly number[], mode: BestRecordMode) {
  const scoresBySong = new Map<number, number>();
  const accuraciesBySong = new Map<number, number>();
  const accuraciesByChart = new Map<number, number>();
  const scoresByChart = new Map<number, number>();
  const requested = new Set(songIds);
  const max = (map: Map<number, number>, id: number, value: number) => map.set(id, Math.max(map.get(id) ?? value, value));
  for (const item of items) {
    if (item.mode !== mode || !requested.has(item.songId) || !Number.isSafeInteger(item.songId) || item.songId <= 0
      || !Number.isSafeInteger(item.chartId) || item.chartId <= 0) continue;
    const { bestScore, bestAccuracy } = item;
    if (typeof bestScore === 'number' && Number.isFinite(bestScore) && bestScore >= 0) {
      max(scoresBySong, item.songId, bestScore);
      max(scoresByChart, item.chartId, bestScore);
    }
    if (typeof bestAccuracy === 'number' && Number.isFinite(bestAccuracy) && bestAccuracy >= 0 && bestAccuracy <= 100) {
      max(accuraciesBySong, item.songId, bestAccuracy / 100);
      max(accuraciesByChart, item.chartId, bestAccuracy / 100);
    }
  }
  return { scoresBySong, scoresByChart, accuraciesBySong, accuraciesByChart };
}
