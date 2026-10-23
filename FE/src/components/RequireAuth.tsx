// 보호 라우트 (설계 3-7). 로그인 확인 중이면 안내만, 익명이면 /login으로, 로그인이면 자식 라우트.
// required=false(VITE_AUTH_REQUIRED=false 빌드)면 검사 없이 통과 — App.tsx가 값을 내려준다.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/authStore';

interface Props {
  required: boolean;
}

export function RequireAuth({ required }: Props) {
  const status = useAuth((s) => s.status);
  const lostReason = useAuth((s) => s.lostReason);
  const location = useLocation();

  if (!required || status === 'authenticated') return <Outlet />;
  if (status === 'anonymous') {
    // 사유가 있으면 로그인 화면이 문구를 보여 준다. 돌아올 경로는 state로 넘긴다
    const to = lostReason ? `/login?error=${lostReason}` : '/login';
    return <Navigate to={to} replace state={{ from: location.pathname + location.search }} />;
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
