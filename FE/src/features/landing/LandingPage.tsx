// 랜딩 라우트 화면 (설계 UX-353 3장). `/`·`/login`·`/signup`·`/welcome`이 모두 이 화면이고, 주소·인증 상태로
// 랜딩만 / 로그인 팝업 / 가입 동의 팝업 / 리다이렉트를 정한다. 비로그인 `/`는 랜딩, 로그인(가입 완료)이면 `/free`.
// VITE_AUTH_REQUIRED=false 빌드는 `/`가 `/free`로 가고, 랜딩은 `/welcome`에서만 열린다(모드·시작은 바로 이동).
import { useCallback, useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AUTH_REQUIRED } from '@/config/auth';
import { LandingView } from '@/features/landing/components/LandingView';
import type { LandingModeKey } from '@/features/landing/components/landingContent';
import { LoginDialog } from '@/features/landing/components/auth/LoginDialog';
import { SignupConsentDialog } from '@/features/landing/components/auth/SignupConsentDialog';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { sanitizeReturnTo } from '@/domain/account/auth';
import { landingDialog, modeRoute } from '@/features/landing/domain/landingRoute';
import { signupGateDecision } from '@/domain/account/signupGate';
import { useAuth } from '@/store/authStore';

const noop = () => {};

export function LandingPage() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const restore = useAuth((s) => s.restore);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    if (AUTH_REQUIRED && status === 'unknown') void restore();
  }, [status, restore]);

  const decision = signupGateDecision({ required: AUTH_REQUIRED, status, user });
  const dialog = landingDialog(location.pathname);
  const rawFrom = (location.state as { from?: string } | null)?.from ?? null;
  const from = sanitizeReturnTo(rawFrom);
  /** 돌아갈 곳이 정해지지 않았으면(/) 기본 모드 */
  const destination = from === '/' ? '/free' : from;

  // 팝업이 열려 있으면 랜딩 단축키·클릭은 무시한다
  const goTo = useCallback(
    (to: string) => {
      if (decision === 'done' || decision === 'pass') navigate(to);
      else if (decision === 'signup') navigate('/signup', { state: { from: to } });
      else navigate('/login', { state: { from: to } });
    },
    [decision, navigate],
  );
  const onStart = useCallback(() => {
    if (dialog === 'none') goTo('/free');
  }, [dialog, goTo]);
  const onMode = useCallback(
    (key: LandingModeKey) => {
      if (dialog === 'none') goTo(modeRoute(key));
    },
    [dialog, goTo],
  );

  // ---- 리다이렉트 ----
  if (location.pathname === '/' && decision === 'pass') return <Navigate to="/free" replace />;
  if (dialog !== 'signup' && decision === 'done') return <Navigate to={destination} replace />;
  if (dialog !== 'signup' && decision === 'signup') return <Navigate to="/signup" replace state={{ from: rawFrom }} />;
  if (dialog === 'signup' && decision === 'login') return <Navigate to="/login" replace state={{ from: rawFrom }} />;
  if (dialog === 'signup' && decision === 'done') return <Navigate to={destination} replace />;

  // 확인 전 랜딩을 그리면 로그인 사용자에게 깜빡인다
  if (dialog !== 'signup' && decision === 'wait') {
    return (
      <div className="landing-auth-wait">
        <div className="auth-wait" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>로그인 확인 중…</span>
        </div>
      </div>
    );
  }

  let popup = null;
  if (dialog === 'login' && (decision === 'login' || decision === 'pass')) {
    popup = (
      <LoginDialog
        returnTo={destination}
        errorCode={params.get('error')}
        // 검사 끈 개발 빌드는 /가 /free로 가므로 랜딩(/welcome)으로 닫는다
        onClose={() => navigate(decision === 'pass' ? '/welcome' : '/', { replace: true })}
      />
    );
  } else if (dialog === 'signup' && decision === 'wait') {
    popup = (
      <Dialog onClose={noop} closeOnEscape={false} closeOnBackdrop={false} label="로그인 확인 중" className="auth-dialog auth-dialog-wait">
        <div className="auth-wait">
          <span className="spinner" aria-hidden="true" />
          <span>로그인 확인 중…</span>
        </div>
      </Dialog>
    );
  } else if (dialog === 'signup') {
    popup = (
      <SignupConsentDialog
        from={destination}
        onDone={(to) => navigate(to, { replace: true })}
        onSwitchAccount={() => void logout().then(() => navigate('/', { replace: true }))}
      />
    );
  }

  // 팝업은 .lp 밖(형제)에 둔다 — .lp 안은 button 전역 스타일이 지워진다
  return (
    <>
      <LandingView onStart={onStart} onMode={onMode} showLogin={decision === 'login' || decision === 'pass'} />
      {popup}
    </>
  );
}
