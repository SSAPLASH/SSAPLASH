// 콜백 화면 (설계 4-B 5~6). BE가 refresh 쿠키를 심고 여기로 302한다. 주소에 토큰은 없다.
// 앱 시작 복원(bootstrapAuth → restore)이 이미 돌고 있으므로 결과만 기다린다. 가입 동의가 필요한 회원(domain/account/signupGate)은
// 원래 목적지를 state.from에 실어 /signup으로, 아니면 원래 화면으로 보낸다.
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTH_REQUIRED } from '@/config/auth';
import { needsSignup } from '@/domain/account/signupGate';
import { useAuth } from '@/store/authStore';

export function AuthCallbackPage() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const lostReason = useAuth((s) => s.lostReason);
  const restore = useAuth((s) => s.restore);
  const consumeReturnTo = useAuth((s) => s.consumeReturnTo);
  const navigate = useNavigate();
  // StrictMode는 effect를 두 번 돌린다. returnTo는 한 번만 꺼내야 하므로 ref로 막는다
  const done = useRef(false);

  useEffect(() => {
    if (status === 'unknown') void restore(); // bootstrap이 먼저 시작했으면 같은 Promise
  }, [status, restore]);

  useEffect(() => {
    if (done.current) return;
    if (status === 'authenticated') {
      done.current = true;
      const to = consumeReturnTo();
      if (AUTH_REQUIRED && needsSignup(user)) navigate('/signup', { replace: true, state: { from: to } });
      else navigate(to, { replace: true });
    } else if (status === 'anonymous') {
      done.current = true;
      // 쿠키가 안 실린 경우(Safari 등)는 no_session, 서버 연결 실패는 network
      navigate(`/login?error=${lostReason === 'network' ? 'network' : 'no_session'}`, { replace: true });
    }
  }, [status, user, lostReason, navigate, consumeReturnTo]);

  return (
    <div className="auth-wait">
      <span className="spinner" aria-hidden="true" />
      <span>로그인 처리 중…</span>
    </div>
  );
}
