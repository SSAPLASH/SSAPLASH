// 가입 동의 팝업 (설계 UX-353 4-4, COACH-003-signup-consent). 랜딩 위에 뜬다.
// 서버 가입 상태(domain/account/signupGate)로 pass/signup을 가르고 동의를 저장한다 — 비로그인·완료 분기는 호출한 쪽(pages/LandingPage)이 맡는다.
// 제출하면 POST로 저장하고 응답으로 회원 정보를 갱신한 뒤 onDone(원래 목적지)을 부른다. VITE_AUTH_REQUIRED=false 빌드(pass)는 저장 없이 /free로 보낸다.
// 약관 개정으로 다시 온 기존 회원(signupCompleted=true)은 추천 학습 동의 상태를 읽어 선택 항목을 미리 켜 둔다(설계 COACH-004 4-4).
// 가입 전 회원은 GET이 403 SIGNUP_INCOMPLETE라 읽지 않고, 선택 항목은 꺼진 채로 시작한다.
// 동의 없이는 앱을 쓸 수 없으므로 Esc·배경으로 닫지 않고, 대신 "다른 계정으로 로그인"을 둔다.
import { useEffect, useState } from 'react';
import { AUTH_REQUIRED } from '@/config/auth';
import { LANDING_MODES } from '@/features/landing/components/landingContent';
import { SignupConsentCard } from './SignupConsentCard';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { signupErrorMessage } from '@/domain/account/auth';
import { modeForRoute } from '@/features/landing/domain/landingRoute';
import { isRecommendationConsentCurrent } from '@/domain/account/recommendationConsent';
import { signupGateDecision } from '@/domain/account/signupGate';
import { recommendationConsentEnabled, SIGNUP_TERMS, type ConsentVersions } from '@/domain/account/signupTerms';
import { useAuth } from '@/store/authStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import './auth.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

interface Props {
  /** 동의 뒤 갈 목적지(검증된 경로) */
  from: string;
  onDone: (to: string) => void;
  /** "다른 계정으로 로그인" — 로그아웃 뒤 이동은 호출한 쪽이 한다 */
  onSwitchAccount: () => void;
}

const noop = () => {};

export function SignupConsentDialog({ from, onDone, onSwitchAccount }: Props) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const submitSignupConsent = useAuth((s) => s.submitSignupConsent);
  const consentStatus = useRecommendationConsent((s) => s.status);
  const consent = useRecommendationConsent((s) => s.consent);
  const loadConsent = useRecommendationConsent((s) => s.load);
  const resetConsent = useRecommendationConsent((s) => s.reset);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decision = signupGateDecision({ required: AUTH_REQUIRED, status, user });
  // 약관 개정 재동의: 이미 가입을 마친 회원만 추천 동의 상태가 있다
  const reconsent = recommendationConsentEnabled() && decision === 'signup' && user?.signupCompleted === true;
  useEffect(() => {
    if (reconsent) void loadConsent();
  }, [reconsent, loadConsent]);

  const modeKey = modeForRoute(from);
  const modeName = modeKey ? LANDING_MODES.find((m) => m.key === modeKey)?.name : null;

  if (reconsent && (consentStatus === 'idle' || consentStatus === 'loading')) {
    return (
      <Dialog onClose={noop} closeOnEscape={false} closeOnBackdrop={false} label="동의 상태 확인 중" className="auth-dialog auth-dialog-wait">
        <div className="auth-wait">
          <span className="spinner" aria-hidden="true" />
          <span>동의 상태 확인 중…</span>
        </div>
      </Dialog>
    );
  }

  const onSubmit = (body: ConsentVersions) => {
    if (decision === 'pass') {
      onDone('/free');
      return;
    }
    setError(null);
    setSubmitting(true);
    // 성공하면 user가 바뀌어 호출한 쪽이 이동한다. 이 컴포넌트가 사라지므로 submitting은 되돌리지 않는다
    submitSignupConsent(body).then(
      () => {
        // 제출한 선택 항목 값이 서버에 반영됐으므로 읽어 둔 옛 상태를 버린다(설정·안내 모달이 다시 읽는다)
        resetConsent();
        onDone(from);
      },
      (e: unknown) => {
        setError(signupErrorMessage(e));
        setSubmitting(false);
      },
    );
  };

  return (
    <Dialog onClose={noop} closeOnEscape={false} closeOnBackdrop={false} label="가입 동의" className="auth-dialog signup-dialog">
      {modeName && <p className="signup-dialog-mode">{modeName} 모드로 시작하기 전에 약관에 동의해 주세요.</p>}
      <SignupConsentCard
        notice={reconsent && consentStatus === 'error' ? <InlineError onRetry={() => void loadConsent()}>동의 상태를 불러오지 못했어요.</InlineError> : undefined}
        terms={recommendationConsentEnabled() && !(reconsent && consentStatus === 'error') ? SIGNUP_TERMS : SIGNUP_TERMS.filter((t) => t.id !== 'recommendation')}
        onSubmit={onSubmit}
        submitting={submitting}
        error={error}
        initialAgreed={reconsent && isRecommendationConsentCurrent(consent) ? ['recommendation'] : []}
      />
      <Button variant="text" className="signup-dialog-switch" disabled={submitting} onClick={onSwitchAccount}>
        다른 계정으로 로그인
      </Button>
    </Dialog>
  );
}
