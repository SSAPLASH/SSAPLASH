// 곡 즐겨찾기의 브라우저 저장 (설계 MODE-001-MODE-003-song-favorite D7-1). 서버 저장을 켜기 전(FAVORITES_REMOTE=false)과 내장 곡 소스에서 쓴다.
// 계정이 아니라 브라우저 단위다 — 같은 브라우저의 다른 계정과 섞인다.

export const FAVORITES_STORAGE_KEY = 'ssaplash.favorites';

/** 저장된 곡 id. 값이 없거나 깨졌으면 빈 배열 */
export function readLocalFavorites(): number[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((v): v is number => Number.isSafeInteger(v) && v !== 0))];
  } catch {
    return [];
  }
}

/** 저장에 성공하면 true. 저장소를 쓸 수 없으면(용량·사생활 보호 모드) false */
export function writeLocalFavorites(ids: readonly number[]): boolean {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}
