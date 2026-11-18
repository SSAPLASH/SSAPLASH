// access 토큰 보관과 refresh·logout (설계 3-3). 토큰은 이 모듈 변수에만 있고 저장소에 쓰지 않는다.
// 인증 경로에는 Bearer·401 재시도 규칙이 없으므로 공통 래퍼(http) 대신 fetch를 직접 쓴다 — http ↔ auth 순환 방지.
import type { ProviderKey } from '@/domain/account/auth';
import { ApiError, errorFromResponse, networkError } from '@/api/error';

/** refresh가 401일 때 재시도 전 대기. 두 탭이 동시에 회전하면 진 쪽이 401을 받고, 이긴 쪽의 새 쿠키로 다시 시도하면 성공한다 */
export const REFRESH_RETRY_DELAY_MS = 300;

type SessionListener = (token: string | null) => void;

let accessToken: string | null = null;
/** 진행 중인 refresh. 있으면 새로 보내지 않고 이 Promise를 돌려준다(단일 실행) */
let inflight: Promise<string | null> | null = null;
const listeners = new Set<SessionListener>();

function setToken(next: string | null): void {
  if (next === accessToken) return;
  accessToken = next;
  for (const l of listeners) l(next);
}

/** 메모리 토큰을 비운다(서버 호출 없음). 회원 탈퇴처럼 서버가 세션을 이미 끝낸 경우에 쓴다 */
export function clearAccessToken(): void {
  setToken(null);
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** 토큰이 바뀔 때(발급·비움) 알린다. store가 "있다가 없어짐"을 세션 소실로 해석한다 */
export function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 로그인 시작 주소. fetch가 아니라 브라우저 전체 이동으로 쓴다(BE가 제공자 동의 화면으로 302) */
export function loginUrl(provider: ProviderKey): string {
  return `/api/auth/${provider}/login`;
}

async function post(path: string): Promise<Response> {
  try {
    return await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch (e) {
    throw networkError(e);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function doRefresh(): Promise<string | null> {
  let res = await post('/api/auth/refresh');
  if (res.status === 401) {
    await sleep(REFRESH_RETRY_DELAY_MS);
    res = await post('/api/auth/refresh');
    if (res.status === 401) {
      setToken(null);
      return null;
    }
  }
  if (!res.ok) throw await errorFromResponse(res);
  const body = (await res.json()) as { accessToken?: unknown };
  if (typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
    throw new ApiError(res.status, 'HTTP_ERROR', 'refresh 응답에 accessToken이 없습니다.');
  }
  setToken(body.accessToken);
  return body.accessToken;
}

/**
 * `POST /api/auth/refresh`. 200이면 토큰을 저장하고 돌려준다. 401이면 잠시 뒤 한 번 더 시도하고,
 * 그래도 401이면 토큰을 비우고 null. 5xx·네트워크 오류는 ApiError를 던지며 기존 토큰은 그대로 둔다.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!inflight) {
    inflight = doRefresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** `POST /api/auth/logout`(204, 멱등). 응답과 무관하게 메모리 토큰을 버린다 */
export async function logout(): Promise<void> {
  try {
    const res = await post('/api/auth/logout');
    if (!res.ok) console.warn(`로그아웃 응답 ${res.status}. 메모리 토큰은 버린다`);
  } catch (e) {
    console.warn('로그아웃 요청 실패. 메모리 토큰은 버린다', e);
  } finally {
    setToken(null);
  }
}

/** 테스트 전용. 토큰·진행 중 요청·구독자를 초기화하고 토큰을 지정할 수 있다 */
export function resetForTest(token: string | null = null): void {
  accessToken = token;
  inflight = null;
  listeners.clear();
}
