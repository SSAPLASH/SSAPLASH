// 보호 라우트 (설계 3-7, COACH-003-signup-consent D25). 로그인 확인 중이면 안내만, 익명이면 /login으로,
// 로그인했지만 가입 동의가 필요하면 /signup으로, 아니면 자식 라우트. 분기는 domain/account/signupGate가 정한다.
// required=false(VITE_AUTH_REQUIRED=false 빌드)면 검사 없이 통과 — App.tsx가 값을 내려준다.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { signupGateDecision } from '@/domain/account/signupGate';
import { useAuth } from '@/store/authStore';

interface Props {
  required: boolean;
}

export function RequireAuth({ required }: Props) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const lostReason = useAuth((s) => s.lostReason);
  const location = useLocation();
  const decision = signupGateDecision({ required, status, user });

  if (decision === 'pass' || decision === 'done') return <Outlet />;
  if (decision === 'login') {
    // 사유가 있으면 로그인 화면이 문구를 보여 준다. 돌아올 경로는 state로 넘긴다
    const to = lostReason ? `/login?error=${lostReason}` : '/login';
    return <Navigate to={to} replace state={{ from: location.pathname + location.search }} />;
  }
  if (decision === 'signup') {
    return <Navigate to="/signup" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <main className="main">
      <div className="auth-wait">
        <span className="spinner" aria-hidden="true" />
        <span>로그인 확인 중…</span>
      </div>
    </main>
  );
}
