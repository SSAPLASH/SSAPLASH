// 곡 선택의 즐겨찾기 필터 (설계 MODE-001-MODE-003-song-favorite 4절). 순수 함수만 둔다.

/** id 목록에 곡을 넣거나 뺀다. 바뀌지 않으면 같은 배열을 돌려준다 */
export function withFavorite(ids: readonly number[], songId: number, on: boolean): readonly number[] {
  const has = ids.includes(songId);
  if (on) return has ? ids : [...ids, songId];
  return has ? ids.filter((id) => id !== songId) : ids;
}

/**
 * 필터가 켜져 있으면 즐겨찾기한 곡만 남긴다(순서 유지). 꺼져 있으면 받은 배열 그대로다.
 * keepIds는 필터를 켠 채 별을 끈 곡이다 — 조건을 바꾸기 전까지는 목록에 남긴다(D5).
 */
export function visibleSongs<T extends { id: number }>(
  songs: readonly T[],
  favoriteIds: ReadonlySet<number>,
  keepIds: ReadonlySet<number>,
  on: boolean,
): readonly T[] {
  if (!on) return songs;
  return songs.filter((s) => favoriteIds.has(s.id) || keepIds.has(s.id));
}
