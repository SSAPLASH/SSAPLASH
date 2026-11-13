// 연주 기록의 곡이 아직 있는지 판정 (설계 CHART-001 4-2, U7). BE는 곡을 소프트 삭제하고, 지운 곡의 상세는 404 `SONG_NOT_FOUND`다.
// 404만 "삭제됨"으로 보고, 네트워크·5xx·401 같은 다른 실패는 "모름"으로 둔다(삭제로 잘못 표시하지 않는다). 요청은 api/song/songs가 한다.

export type SongAvailability = 'available' | 'deleted' | 'unknown';

export const DELETED_SONG_LABEL = '삭제된 곡';

/** 곡 상세 조회 실패 → 판정. status·code만 본다 */
export function availabilityFromFailure(failure: { status?: number; code?: string } | null | undefined): SongAvailability {
  if (failure && failure.status === 404 && failure.code === 'SONG_NOT_FOUND') return 'deleted';
  return 'unknown';
}

/** 연주 기록들에서 조회할 BE 곡 id만 뽑는다(내장 채보 로그는 id가 없다). 같은 곡은 한 번 */
export function songIdsToCheck(logs: readonly { songNumericId?: number | null }[]): number[] {
  const ids = new Set<number>();
  for (const l of logs) {
    if (typeof l.songNumericId === 'number' && Number.isSafeInteger(l.songNumericId) && l.songNumericId > 0) ids.add(l.songNumericId);
  }
  return [...ids];
}
