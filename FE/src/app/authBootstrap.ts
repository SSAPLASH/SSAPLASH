// 로그인 상태 접착 (설계 4-A). main.tsx에서 bootstrapInput 뒤 한 번 부른다.
import { subscribeSession } from '@/api/auth';
import { useAuth } from '@/store/authStore';

/**
 * 로그인 검사 여부. 빌드 시 VITE_AUTH_REQUIRED=false면 RequireAuth가 모든 화면을 통과시킨다 —
 * BE 없이 게임 화면을 개발할 때 `.env.local`에 둔다. 미설정(운영 빌드)은 켜짐.
 */
export const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED !== 'false';

export function bootstrapAuth(): void {
  // 토큰이 없어지면(refresh 실패, 다른 경로의 로그아웃) 로그인 상태를 내린다. restoring·anonymous면 무시된다
  subscribeSession((token) => {
    if (token === null) useAuth.getState().sessionLost();
  });
  // 시작 복원. 결과는 RequireAuth·콜백 화면이 store로 본다
  void useAuth.getState().restore();
}
