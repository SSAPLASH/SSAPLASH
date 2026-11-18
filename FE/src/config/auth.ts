/**
 * 로그인 검사 여부. 빌드 시 VITE_AUTH_REQUIRED=false면 RequireAuth가 모든 화면을 통과시킨다 —
 * BE 없이 게임 화면을 개발할 때 `.env.local`에 둔다. 미설정(운영 빌드)은 켜짐.
 */
export const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED !== 'false';
