// 가입 동의 화면 (설계 COACH-003-signup-consent). 로그인 화면과 같은 2분할(좌 브랜드·우 카드), PublicLayout 아래.
// 2단계 완료: 서버 가입 상태(domain/signupGate)로 분기하고 동의를 저장한다 — 비로그인은 /login, 가입이 끝난 회원은 원래 목적지,
// 동의가 필요한 회원만 카드를 본다. 제출하면 POST로 저장하고 응답으로 회원 정보를 갱신한 뒤 원래 목적지로 간다.
// VITE_AUTH_REQUIRED=false 빌드는 검사 없이 카드를 보이고 제출하면 홈으로 간다.
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AUTH_REQUIRED } from '@/app/authBootstrap';
import { AuthBrandPane } from '@/components/auth/AuthBrandPane';
import { SignupConsentCard } from '@/components/auth/SignupConsentCard';
import { sanitizeReturnTo, signupErrorMessage } from '@/domain/auth';
import { signupGateDecision } from '@/domain/signupGate';
import type { ConsentVersions } from '@/domain/signupTerms';
import { useAuth } from '@/store/authStore';

export function SignupPage() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const restore = useAuth((s) => s.restore);
  const submitSignupConsent = useAuth((s) => s.submitSignupConsent);
  const location = useLocation();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (AUTH_REQUIRED && status === 'unknown') void restore();
  }, [status, restore]);

  const from = sanitizeReturnTo((location.state as { from?: string } | null)?.from ?? null);
  const decision = signupGateDecision({ required: AUTH_REQUIRED, status, user });

  if (decision === 'wait') {
    return (
      <div className="auth-wait">
        <span className="spinner" aria-hidden="true" />
        <span>로그인 확인 중…</span>
      </div>
    );
  }
  if (decision === 'login') return <Navigate to="/login" replace />;
  if (decision === 'done') return <Navigate to={from} replace />;

  const onSubmit = (body: ConsentVersions) => {
    if (decision === 'pass') {
      navigate('/', { replace: true });
      return;
    }
    setError(null);
    setSubmitting(true);
    // 성공하면 user가 바뀌어 decision이 done이 되고 페이지가 이동한다. 이 컴포넌트가 사라지므로 submitting은 되돌리지 않는다
    submitSignupConsent(body).then(
      () => navigate(from, { replace: true }),
      (e: unknown) => {
        setError(signupErrorMessage(e));
        setSubmitting(false);
      },
    );
  };

  return (
    <div className="login">
      <AuthBrandPane />
      <SignupConsentCard onSubmit={onSubmit} submitting={submitting} error={error} />
    </div>
  );
}
