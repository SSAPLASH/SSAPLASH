// 가입 동의가 필요한지의 순수 판단과 라우트 결정 (설계 COACH-003-signup-consent D24·D25·D28).
// 콜백·RequireAuth·SignupConsentDialog·403 처리가 모두 이 파일의 판단을 쓴다. React·브라우저·fetch·store에 의존하지 않는다.
import type { UserMe } from './auth';
import { isConsentCurrent } from '../play/dataConsent';
import { SIGNUP_TERMS, termVersion, type SignupTerm } from './signupTerms';

/** BE가 가입 동의 전 회원의 API 호출에 돌려주는 403 오류 코드 (메일 ACCT-001 회신) */
export const SIGNUP_INCOMPLETE = 'SIGNUP_INCOMPLETE';

/** 로그인 상태. store의 AuthStatus와 같은 값이다(도메인은 store를 import하지 않는다) */
export type GateStatus = 'unknown' | 'restoring' | 'authenticated' | 'anonymous';

/**
 * 가입 동의 화면을 거쳐야 하는가. 회원이 없으면 false.
 * 전환기 규칙(D28): `signupCompleted` 필드가 없는 응답(BE 가입 동의 단계 미병합)은 가입 완료로 보고 아무것도 검사하지 않는다.
 */
export function needsSignup(user: UserMe | null | undefined, terms: readonly SignupTerm[] = SIGNUP_TERMS): boolean {
  if (!user) return false;
  if (user.signupCompleted === undefined) return false;
  if (user.signupCompleted === false) return true;
  const termsRecord = user.consents?.terms;
  if (termsRecord && termsRecord.version !== termVersion('terms', terms)) return true;
  const privacyRecord = user.consents?.privacy;
  if (privacyRecord && privacyRecord.version !== termVersion('privacy', terms)) return true;
  return !isConsentCurrent(user.dataConsent, termVersion('dataConsent', terms));
}

/** 라우트 결정. pass: 검사 안 함 · wait: 로그인 확인 중 · login: 비로그인 · signup: 동의 필요 · done: 통과 */
export type SignupGateDecision = 'pass' | 'wait' | 'login' | 'signup' | 'done';

export function signupGateDecision(
  args: { required: boolean; status: GateStatus; user: UserMe | null },
  terms: readonly SignupTerm[] = SIGNUP_TERMS,
): SignupGateDecision {
  if (!args.required) return 'pass';
  if (args.status === 'unknown' || args.status === 'restoring') return 'wait';
  if (args.status === 'anonymous') return 'login';
  return needsSignup(args.user, terms) ? 'signup' : 'done';
}
