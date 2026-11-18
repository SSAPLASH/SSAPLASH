// 로그인 상태 (설계 3-6). 영속하지 않는다 — access 토큰은 api/account/auth가 메모리에 들고, 새로고침 복원은 refresh 쿠키로 한다.
import { create } from 'zustand';
import { clearAccessToken, loginUrl, logout as logoutApi, refreshAccessToken } from '@/api/account/auth';
import { ApiError } from '@/api/http';
import { fetchMe, postSignupConsent, withdrawMe } from '@/api/account/users';
import { RETURN_TO_KEY, sanitizeReturnTo, type LoginErrorCode, type ProviderKey, type UserMe } from '@/domain/account/auth';
import { ACTIVE_JOB_KEY } from '@/domain/song/chartJob';
import type { ConsentVersions } from '@/domain/account/signupTerms';

/** unknown: 앱 시작 직후 · restoring: refresh·me 진행 중 · authenticated · anonymous */
export type AuthStatus = 'unknown' | 'restoring' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  /** authenticated일 때만 값 */
  user: UserMe | null;
  /** 익명으로 떨어진 사유. RequireAuth가 /login?error=에 붙이고 로그인 화면이 읽은 뒤 지운다 */
  lostReason: LoginErrorCode | null;

  /** refresh → me로 로그인 복원. 진행 중이면 같은 Promise를 돌려준다(콜백 화면과 앱 시작이 겹쳐도 한 번) */
  restore: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * 회원 탈퇴. 성공(204)만 탈퇴로 본다 — 로컬 흔적을 지우고 anonymous + withdrawn.
   * 401은 탈퇴 근거가 아니라 인증 만료다: 토큰을 비우고 session_expired로 내린 뒤 던진다(로컬 데이터 유지). 그 밖의 오류는 상태를 두고 던진다
   */
  withdraw: () => Promise<void>;
  /**
   * `/me`를 다시 읽어 user를 바꾼다(403 SIGNUP_INCOMPLETE 뒤 상태 갱신). authenticated일 때만 동작하고 단일 실행이다.
   * 실패하면 가입 미완료로 내려(signupCompleted=false) 더 부르지 않는다(D27). 던지지 않는다
   */
  refreshMe: () => Promise<void>;
  /** 가입 동의 저장. 성공 응답(`/me` 본문)으로 user를 통째로 바꾼다. 실패는 그대로 던진다(D29) */
  submitSignupConsent: (body: ConsentVersions) => Promise<void>;
  /** 토큰이 없어졌을 때(api/account/auth 구독). authenticated에서만 동작한다 */
  sessionLost: () => void;
  clearLostReason: () => void;
  /** 돌아갈 경로를 sessionStorage에 두고 BE 로그인 시작 주소로 브라우저를 통째로 보낸다(fetch 아님) */
  startLogin: (provider: ProviderKey, returnTo: string | null) => void;
  /** 로그인 뒤 돌아갈 경로를 꺼내고 지운다. 없거나 쓸 수 없으면 홈 */
  consumeReturnTo: () => string;
}

/** sessionStorage는 사생활 보호 모드·차단 설정에서 던질 수 있다. 토큰이 아니라 경로라서 실패해도 로그인은 진행한다 */
function saveReturnTo(path: string): void {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch {
    // 저장 못 하면 로그인 뒤 홈으로 간다
  }
}

function takeReturnTo(): string | null {
  try {
    const v = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return v;
  } catch {
    return null;
  }
}

type Set = (partial: Partial<AuthState>) => void;

/** 진행 중인 복원. 모듈 변수라 테스트는 resetAuthStoreForTest로 지운다 */
let restoring: Promise<void> | null = null;
/** 진행 중인 /me 재조회(단일 실행). 테스트는 resetAuthStoreForTest로 지운다 */
let refreshingMe: Promise<void> | null = null;

async function runRestore(set: Set): Promise<void> {
  set({ status: 'restoring' });
  let token: string | null;
  try {
    token = await refreshAccessToken();
  } catch {
    // 5xx·네트워크: 서버 쪽 문제. 로그인 화면에서 안내한다
    set({ status: 'anonymous', user: null, lostReason: 'network' });
    return;
  }
  if (token === null) {
    // 세션 없음. 처음 방문과 구분하지 않으므로 사유는 두지 않는다
    set({ status: 'anonymous', user: null });
    return;
  }
  try {
    const user = await fetchMe();
    set({ status: 'authenticated', user, lostReason: null });
  } catch (e) {
    const reason: LoginErrorCode = e instanceof ApiError && e.status === 401 ? 'no_session' : 'network';
    set({ status: 'anonymous', user: null, lostReason: reason });
  }
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'unknown',
  user: null,
  lostReason: null,

  restore: () => {
    if (!restoring) {
      restoring = runRestore(set).finally(() => {
        restoring = null;
      });
    }
    return restoring;
  },
  logout: async () => {
    // 먼저 내리고 서버에 알린다. 토큰 비움 알림(sessionLost)은 이미 anonymous라 무시된다
    set({ status: 'anonymous', user: null, lostReason: null });
    // 다른 계정으로 로그인했을 때 이전 계정의 채보 작업을 폴링하지 않게 기록을 지운다
    try {
      localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      // 저장소를 못 써도 로그아웃은 진행한다
    }
    await logoutApi();
  },
  withdraw: async () => {
    try {
      await withdrawMe();
    } catch (e) {
      // 401은 refresh·재시도 뒤에도 인증이 안 된 것이지 탈퇴 완료가 아니다(BE 요청). 세션 만료와 같게 내리고 던진다.
      // refresh가 401이라 토큰이 이미 비워졌으면 sessionLost는 구독으로 먼저 불렸고 여기서는 무시된다
      if (e instanceof ApiError && e.status === 401) {
        clearAccessToken();
        get().sessionLost();
      }
      // 네트워크·5xx는 상태를 두고 호출자가 보인다
      throw e;
    }
    try {
      localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      // 저장소를 못 써도 탈퇴는 끝난 것이다
    }
    // 상태를 먼저 내린다. 토큰 비움 알림(sessionLost)은 이미 anonymous라 무시된다
    set({ status: 'anonymous', user: null, lostReason: 'withdrawn' });
    clearAccessToken();
  },
  refreshMe: () => {
    if (refreshingMe) return refreshingMe;
    const s = get();
    if (s.status !== 'authenticated' || !s.user) return Promise.resolve();
    const user = s.user;
    refreshingMe = (async () => {
      try {
        const fresh = await fetchMe();
        if (get().status === 'authenticated') set({ user: fresh });
      } catch {
        if (get().status === 'authenticated') set({ user: { ...user, signupCompleted: false } });
      } finally {
        refreshingMe = null;
      }
    })();
    return refreshingMe;
  },
  submitSignupConsent: async (body) => {
    if (get().status !== 'authenticated') return;
    const user = await postSignupConsent(body);
    if (get().status === 'authenticated') set({ user });
  },
  sessionLost: () => {
    if (get().status !== 'authenticated') return;
    set({ status: 'anonymous', user: null, lostReason: 'session_expired' });
  },
  clearLostReason: () => set({ lostReason: null }),
  startLogin: (provider, returnTo) => {
    saveReturnTo(sanitizeReturnTo(returnTo));
    window.location.assign(loginUrl(provider));
  },
  consumeReturnTo: () => sanitizeReturnTo(takeReturnTo()),
}));

/** 테스트 전용. 진행 중 복원과 상태를 초기화한다 */
export function resetAuthStoreForTest(): void {
  restoring = null;
  refreshingMe = null;
  useAuth.setState({ status: 'unknown', user: null, lostReason: null });
}
