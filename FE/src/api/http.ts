// BE 호출 공통 래퍼 (설계 3-4). Bearer 부착, JSON 직렬화, problem+json 해석, 401 → refresh 1회 → 같은 요청 재시도.
// 화면·store는 이 함수만 쓰고 401을 직접 처리하지 않는다.
import { getAccessToken, refreshAccessToken } from '@/api/account/auth';
import { SIGNUP_INCOMPLETE } from '@/domain/account/signupGate';
import { errorFromResponse, networkError } from './error';

export { ApiError } from './error';
export type { ApiFieldError } from './error';

/** 같은 출처. 운영은 Nginx가 `/api`를 BE로, 개발은 Vite 프록시가 넘긴다 */
export const API_BASE = '';

/** 인증 API는 refresh 재시도 대상이 아니다(refresh 자체가 401이면 세션이 없는 것) */
const AUTH_PREFIX = '/api/auth/';

export interface ApiRequestInit {
  method?: string;
  /** JSON으로 직렬화한다. undefined면 본문 없음. FormData면 그대로 보내고 Content-Type은 브라우저가 boundary와 함께 붙인다 */
  body?: unknown;
  /** 기본 헤더 위에 덮어쓴다(예: Idempotency-Key) */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * 401을 받으면 refresh는 한 번 하되 원래 요청은 다시 보내지 않고 401 ApiError를 던진다.
   * 재전송하면 안 되는 요청(텔레메트리 배치 등)용. 기본 false(재전송)
   */
  noRetryOn401?: boolean;
}

type SignupIncompleteListener = () => void;
const signupIncompleteListeners = new Set<SignupIncompleteListener>();

/** 403 SIGNUP_INCOMPLETE(가입 동의 전 회원의 API 호출)를 받을 때 알린다. 이동은 라우트가 하고 여기서는 알리기만 한다(설계 D26) */
export function subscribeSignupIncomplete(listener: SignupIncompleteListener): () => void {
  signupIncompleteListeners.add(listener);
  return () => {
    signupIncompleteListeners.delete(listener);
  };
}

/** 테스트 전용. 등록된 가입 미완료 리스너를 모두 지운다 */
export function resetSignupIncompleteForTest(): void {
  signupIncompleteListeners.clear();
}

async function send(path: string, init: ApiRequestInit): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const hasBody = init.body !== undefined;
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (hasBody && !isForm) headers.set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(init.headers ?? {})) headers.set(k, v);
  try {
    return await fetch(API_BASE + path, {
      method: init.method ?? 'GET',
      headers,
      body: !hasBody ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (e) {
    throw networkError(e);
  }
}

/**
 * BE 호출. 2xx면 JSON 본문(204·빈 본문은 undefined), 아니면 ApiError를 던진다.
 * 401이면 refresh를 한 번 하고 새 토큰으로 재시도한다(`noRetryOn401`이면 refresh만 하고 재시도 안 함). refresh가 null이면(세션 없음) 원래 401을 던지고,
 * refresh가 throw하면(5xx·네트워크) 그 오류를 그대로 전파한다.
 */
export async function apiFetch<T = void>(path: string, init: ApiRequestInit = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !path.startsWith(AUTH_PREFIX)) {
    const token = await refreshAccessToken();
    if (token !== null && !init.noRetryOn401) res = await send(path, init);
  }
  if (!res.ok) {
    const err = await errorFromResponse(res);
    if (res.status === 403 && err.code === SIGNUP_INCOMPLETE) {
      for (const l of [...signupIncompleteListeners]) l();
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}
