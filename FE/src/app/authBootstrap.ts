// 로그인 상태 접착 (설계 4-A). main.tsx에서 bootstrapInput 뒤 한 번 부른다.
import { subscribeSession } from '@/api/auth';
import { bindLegacyConsentUpload } from '@/app/dataConsent';
import { clearPlayLogs, setPlayLogOwner } from '@/engine/playLog';
import { useAuth } from '@/store/authStore';

/**
 * 로그인 검사 여부. 빌드 시 VITE_AUTH_REQUIRED=false면 RequireAuth가 모든 화면을 통과시킨다 —
 * BE 없이 게임 화면을 개발할 때 `.env.local`에 둔다. 미설정(운영 빌드)은 켜짐.
 */
export const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED !== 'false';

/**
 * 로컬 플레이 로그의 주인을 로그인 계정에 맞춘다(설계 ACCT-001 마이페이지 D5·D6).
 * 다른 계정의 기록은 보이지 않고, 탈퇴하면 그 계정의 로컬 기록을 지운다. 해제 함수를 돌려준다(테스트용)
 */
export function bindPlayLogOwner(): () => void {
  const ownerOf = (s: ReturnType<typeof useAuth.getState>) =>
    s.status === 'authenticated' && s.user ? s.user.id : null;
  setPlayLogOwner(ownerOf(useAuth.getState()));
  return useAuth.subscribe((s, prev) => {
    if (s.lostReason === 'withdrawn' && prev.lostReason !== 'withdrawn' && prev.user) clearPlayLogs(prev.user.id);
    setPlayLogOwner(ownerOf(s));
  });
}

export function bootstrapAuth(): void {
  bindPlayLogOwner();
  // 옛 브라우저 동의 값을 로그인 뒤 서버로 한 번 옮긴다
  bindLegacyConsentUpload();
  // 토큰이 없어지면(refresh 실패, 다른 경로의 로그아웃) 로그인 상태를 내린다. restoring·anonymous면 무시된다
  subscribeSession((token) => {
    if (token === null) useAuth.getState().sessionLost();
  });
  // 시작 복원. 결과는 RequireAuth·콜백 화면이 store로 본다
  void useAuth.getState().restore();
}
