// 관리자 전용 라우트 (Jira 262). RequireAuth 안쪽에 둔다. ADMIN이 아니면 /free로 보낸다.
// 화면을 숨기는 것일 뿐 권한 판단은 BE(@PreAuthorize ADMIN)가 한다 — 주소를 알아도 API는 403이다.
import { Navigate, Outlet } from 'react-router-dom';
import { isAdmin } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';

export function RequireAdmin() {
  const admin = useAuth((s) => isAdmin(s.user));
  return admin ? <Outlet /> : <Navigate to="/free" replace />;
}
