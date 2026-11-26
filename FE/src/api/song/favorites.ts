// 곡 즐겨찾기 API (설계 MODE-001-MODE-003-song-favorite 3절). 저장 단위는 (사용자, 곡)이고 리듬 게임·악보 연습이 같이 쓴다.
// `config/favorites`의 FAVORITES_REMOTE가 참일 때만 불린다.
import { apiFetch } from '@/api/http';

/** `GET /api/v1/songs/favorites` — 즐겨찾기한 곡 id. 모르는 값은 버린다 */
export async function listFavoriteSongIds(signal?: AbortSignal): Promise<number[]> {
  const body = await apiFetch<{ songIds?: unknown }>('/api/v1/songs/favorites', { signal });
  const raw = Array.isArray(body?.songIds) ? body.songIds : [];
  const ids = raw.map((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v)).filter((v): v is number => Number.isSafeInteger(v));
  return [...new Set(ids)];
}

/** `PUT /api/v1/songs/{songId}/favorite` — 이미 있어도 성공(204) */
export async function addFavoriteSong(songId: number): Promise<void> {
  await apiFetch(`/api/v1/songs/${songId}/favorite`, { method: 'PUT' });
}

/** `DELETE /api/v1/songs/{songId}/favorite` — 없어도 성공(204) */
export async function removeFavoriteSong(songId: number): Promise<void> {
  await apiFetch(`/api/v1/songs/${songId}/favorite`, { method: 'DELETE' });
}
