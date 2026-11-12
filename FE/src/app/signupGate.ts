// 가입 미완료 알림 접착 (설계 COACH-003-signup-consent D26·D27). bootstrapAuth가 한 번 부른다.
// api/http가 403 SIGNUP_INCOMPLETE를 알리면 /me를 한 번 다시 읽는다. 이미 가입이 필요한 상태면 무시해 반복을 막는다.
// 다시 읽은 결과로 signupCompleted가 false가 되면 RequireAuth가 /signup으로 보낸다 — 여기서는 이동하지 않는다.
import { subscribeSignupIncomplete } from '@/api/http';
import { needsSignup } from '@/domain/account/signupGate';
import { useAuth } from '@/store/authStore';

/** 해제 함수를 돌려준다(테스트용) */
export function bindSignupIncomplete(): () => void {
  return subscribeSignupIncomplete(() => {
    const s = useAuth.getState();
    if (s.status === 'authenticated' && !needsSignup(s.user)) void s.refreshMe();
  });
}
