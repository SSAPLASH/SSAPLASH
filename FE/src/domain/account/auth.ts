// 로그인·회원 도메인 타입과 순수 규칙. BE 계약은 mail 회신(ACCT-001 소셜로그인 결정 전달) 2절.
// 브라우저·React·fetch에 의존하지 않는다.

/** `GET /api/users/me`의 provider 값. 회원이 로그인한 제공자 */
export type SocialProvider = 'GOOGLE' | 'SSAFY';
export type UserRole = 'USER' | 'ADMIN';
/** BE 경로 값. `GET /api/auth/{provider}/login` */
export type ProviderKey = 'google' | 'ssafy';

/** `GET /api/users/me`의 dataConsent. 답한 적 없으면 셋 다 null (메일 ACCT-002 회신) */
export interface DataConsent {
  agreed: boolean | null;
  version: string | null;
  updatedAt: string | null;
}

/** 약관·개인정보 동의 기록. 어느 판에 언제 동의했는지 (메일 ACCT-001 회신) */
export interface ConsentRecord {
  version: string;
  agreedAt: string;
}

/** `GET /api/users/me` 응답. 시각은 ISO-8601 UTC 문자열 그대로 둔다 */
export interface UserMe {
  id: number;
  provider: SocialProvider;
  nickname: string;
  profileImageUrl: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  dataConsent: DataConsent;
  /** 가입 동의 완료 여부. 이용약관·개인정보 둘 다 동의 기록이 있으면 true (메일 ACCT-001 회신). 전환기(D28)에는 필드가 없는 응답을 완료로 본다 — 판단은 domain/account/signupGate */
  signupCompleted: boolean;
  /** 이용약관·개인정보 동의 기록. 동의한 적 없으면 null (메일 ACCT-001 회신) */
  consents: { terms: ConsentRecord | null; privacy: ConsentRecord | null };
}

export interface LoginProvider {
  key: ProviderKey;
  label: string;
}

/** 관리자 화면을 보여 줄지. 표시만 정하고 권한 판단은 BE(@PreAuthorize ADMIN)가 한다 (Jira 262) */
export function isAdmin(user: Pick<UserMe, 'role'> | null): boolean {
  return user?.role === 'ADMIN';
}

/** 로그인 화면이 이 순서로 버튼을 그린다. BE에 그 제공자 키가 없으면 BE가 404를 돌려준다 */
export const LOGIN_PROVIDERS: readonly LoginProvider[] = [
  { key: 'google', label: 'Google로 계속하기' },
  { key: 'ssafy', label: 'SSAFY로 계속하기' },
];

/**
 * 로그인 화면에 보일 제공자. `raw`는 환경변수 VITE_LOGIN_PROVIDERS 값(쉼표 구분 키).
 * 미설정·빈 값이면 전부, 아니면 LOGIN_PROVIDERS에 있는 키만 원래 순서로. 모르는 키는 무시하고, 결과가 비면 전부.
 */
export function enabledProviders(raw: string | undefined): readonly LoginProvider[] {
  if (!raw || raw.trim() === '') return LOGIN_PROVIDERS;
  const keys = new Set(raw.split(',').map((k) => k.trim().toLowerCase()));
  const picked = LOGIN_PROVIDERS.filter((p) => keys.has(p.key));
  return picked.length > 0 ? picked : LOGIN_PROVIDERS;
}

/**
 * `/login?error=` 코드. BE가 붙이는 것: access_denied(동의 취소) · oauth_failed(그 밖의 실패).
 * FE가 붙이는 것: no_session(콜백 뒤 refresh 실패) · session_expired(사용 중 세션 소실) · network(서버 연결 실패) · withdrawn(회원 탈퇴 완료).
 */
export type LoginErrorCode = 'access_denied' | 'oauth_failed' | 'no_session' | 'session_expired' | 'network' | 'withdrawn';

const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  access_denied: '로그인을 취소했습니다. 다시 시도해 주세요.',
  oauth_failed: '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  no_session: '로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.',
  session_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  network: '서버에 연결할 수 없습니다. 서버 상태를 확인한 뒤 다시 시도해 주세요.',
  withdrawn: '탈퇴가 완료되었습니다. 같은 계정으로 다시 로그인하면 새 회원으로 시작합니다.',
};

/** 오류 코드의 안내 문구. 모르는 코드·빈 값은 null */
export function loginErrorMessage(code: string | null): string | null {
  if (!code || !Object.hasOwn(LOGIN_ERROR_MESSAGES, code)) return null;
  return LOGIN_ERROR_MESSAGES[code as LoginErrorCode];
}

/** 가입 동의 판이 서버 허용 목록과 어긋났을 때 BE가 주는 오류 코드(422, 메일 INFRA_보안헤더-CSP-화면확인 회신 4) */
export const SIGNUP_CONSENT_VERSION_INVALID = 'SIGNUP_CONSENT_VERSION_INVALID';

/**
 * 가입 동의 저장 실패 문구(D31). 페이지가 api를 import하지 않도록 오류를 구조(`code`·`detail`)로 읽는다.
 * 판 불일치는 서버 `detail`(어긋난 필드 이름)을 보이지 않고 새로고침을 안내한다.
 */
export function signupErrorMessage(e: unknown): string {
  const { code, detail } = e instanceof Error ? (e as { code?: unknown; detail?: unknown }) : ({} as { code?: unknown; detail?: unknown });
  if (code === 'NETWORK') return loginErrorMessage('network') ?? '서버에 연결할 수 없습니다.';
  if (code === SIGNUP_CONSENT_VERSION_INVALID) return '약관이 갱신되었어요. 새로고침한 뒤 다시 동의해 주세요.';
  if (typeof detail === 'string' && detail) return detail;
  return '동의를 저장하지 못했습니다. 다시 시도해 주세요.';
}

/** 로그인 뒤 돌아갈 경로를 두는 sessionStorage 키. 토큰이 아니라 경로 문자열만 저장한다 */
export const RETURN_TO_KEY = 'ssaplash.auth.returnTo';

/**
 * 로그인 뒤 돌아갈 경로 검증. 앱 안의 절대 경로만 허용하고 나머지는 홈.
 * 외부 URL·`//host`·`/\host`는 오픈 리다이렉트, `/login`·`/auth/*`는 로그인 루프가 되므로 막는다.
 */
export function sanitizeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/') || raw.startsWith('/auth/')) return '/';
  return raw;
}
