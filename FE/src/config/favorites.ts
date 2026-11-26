/**
 * 곡 즐겨찾기 저장 위치(설계 MODE-001-MODE-003-song-favorite D7-1).
 * 빌드 시 VITE_FAVORITES_API=true면 서버(`/api/v1/songs/favorites`)에 저장하고, 미설정이면 브라우저(localStorage)에 저장한다.
 * BE API가 나오기 전까지는 미설정으로 둔다.
 */
export const FAVORITES_REMOTE = import.meta.env.VITE_FAVORITES_API === 'true';
