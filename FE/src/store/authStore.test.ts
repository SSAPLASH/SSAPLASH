import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthStoreForTest, useAuth } from './authStore';
import { REFRESH_RETRY_DELAY_MS, getAccessToken, resetForTest } from '@/api/account/auth';
import { RETURN_TO_KEY, type UserMe } from '@/domain/account/auth';
import { currentConsentVersions, termVersion } from '@/domain/account/signupTerms';

type Handler = (url: string, init: RequestInit | undefined) => Response;

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const ME: UserMe = {
  id: 7,
  provider: 'GOOGLE',
  nickname: '원빈',
  profileImageUrl: null,
  role: 'USER',
  createdAt: '2026-10-20T03:00:00Z',
  updatedAt: '2026-10-20T03:00:00Z',
  dataConsent: { agreed: true, version: termVersion('dataConsent'), updatedAt: '2026-11-02T01:00:00Z' },
  signupCompleted: true,
  consents: {
    terms: { version: termVersion('terms'), agreedAt: '2026-11-02T01:00:00Z' },
    privacy: { version: termVersion('privacy'), agreedAt: '2026-11-02T01:00:00Z' },
  },
};
const tokenOk = () => json(200, { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 1800 });
const problem = (status: number, code: string) => json(status, { status, code, detail: 'x' }, 'application/problem+json');

/** refresh·me 응답을 URL별로 정한다 */
function server(refresh: () => Response, me: () => Response) {
  return mockFetch((url) => (url === '/api/auth/refresh' ? refresh() : url === '/api/users/me' ? me() : problem(404, 'NOT_FOUND')));
}

beforeEach(() => {
  resetForTest();
  resetAuthStoreForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('restore', () => {
  it('시작 상태는 unknown이고, 부르면 restoring을 거쳐 authenticated + user', async () => {
    server(tokenOk, () => json(200, ME));
    expect(useAuth.getState().status).toBe('unknown');

    const p = useAuth.getState().restore();
    expect(useAuth.getState().status).toBe('restoring');
    await p;

    expect(useAuth.getState()).toMatchObject({ status: 'authenticated', user: ME, lostReason: null });
    expect(getAccessToken()).toBe('tok');
  });

  it('refresh가 세션 없음(401)이면 anonymous, 사유 없음', async () => {
    vi.useFakeTimers();
    server(() => problem(401, 'UNAUTHORIZED'), () => json(200, ME));

    const p = useAuth.getState().restore();
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    await p;

    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: null });
  });

  it('서버에 연결할 수 없으면 anonymous + network', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    await useAuth.getState().restore();

    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: 'network' });
  });

  it('refresh 5xx도 anonymous + network', async () => {
    server(() => problem(500, 'INTERNAL_ERROR'), () => json(200, ME));
    await useAuth.getState().restore();
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', lostReason: 'network' });
  });

  it('토큰은 받았는데 me가 401이면 anonymous + no_session', async () => {
    server(tokenOk, () => problem(401, 'UNAUTHORIZED'));
    await useAuth.getState().restore();
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: 'no_session' });
  });

  it('me가 5xx면 anonymous + network', async () => {
    server(tokenOk, () => problem(500, 'INTERNAL_ERROR'));
    await useAuth.getState().restore();
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', lostReason: 'network' });
  });

  it('진행 중에 다시 부르면 같은 Promise를 돌려주고 요청은 한 번이다', async () => {
    const fetch = server(tokenOk, () => json(200, ME));
    const a = useAuth.getState().restore();
    const b = useAuth.getState().restore();
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(fetch.mock.calls.filter(([u]) => u === '/api/auth/refresh')).toHaveLength(1);
    expect(fetch.mock.calls.filter(([u]) => u === '/api/users/me')).toHaveLength(1);
  });

  it('끝난 뒤 다시 부르면 새로 복원한다', async () => {
    const fetch = server(tokenOk, () => json(200, ME));
    await useAuth.getState().restore();
    await useAuth.getState().restore();
    expect(fetch.mock.calls.filter(([u]) => u === '/api/users/me')).toHaveLength(2);
  });
});

describe('sessionLost', () => {
  it('authenticated에서 부르면 anonymous + session_expired', () => {
    useAuth.setState({ status: 'authenticated', user: ME, lostReason: null });
    useAuth.getState().sessionLost();
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: 'session_expired' });
  });

  it('anonymous·restoring에서는 아무것도 바꾸지 않는다', () => {
    useAuth.setState({ status: 'anonymous', user: null, lostReason: null });
    useAuth.getState().sessionLost();
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', lostReason: null });

    useAuth.setState({ status: 'restoring' });
    useAuth.getState().sessionLost();
    expect(useAuth.getState().status).toBe('restoring');
  });
});

describe('logout', () => {
  it('POST /api/auth/logout을 보내고 anonymous, user·lostReason은 null', async () => {
    resetForTest('tok');
    useAuth.setState({ status: 'authenticated', user: ME, lostReason: null });
    const fetch = mockFetch(() => new Response(null, { status: 204 }));

    await useAuth.getState().logout();

    expect(fetch.mock.calls[0][0]).toBe('/api/auth/logout');
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: null });
    expect(getAccessToken()).toBeNull();
  });

  it('활성 채보 작업 기록(localStorage)을 지운다', async () => {
    const store = new Map<string, string>([['ssaplash.chartJob.v1', 'job']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    resetForTest('tok');
    useAuth.setState({ status: 'authenticated', user: ME, lostReason: null });
    mockFetch(() => new Response(null, { status: 204 }));

    await useAuth.getState().logout();

    expect(store.has('ssaplash.chartJob.v1')).toBe(false);
  });

  it('요청이 실패해도 anonymous로 끝난다', async () => {
    resetForTest('tok');
    useAuth.setState({ status: 'authenticated', user: ME });
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(useAuth.getState().logout()).resolves.toBeUndefined();

    expect(useAuth.getState().status).toBe('anonymous');
    warn.mockRestore();
  });
});

describe('withdraw', () => {
  // 테스트 환경은 node라 localStorage가 없다 — Map 기반 스텁
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    store.set('ssaplash.chartJob.v1', 'job');
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    resetForTest('tok');
    useAuth.setState({ status: 'authenticated', user: ME, lostReason: null });
  });

  it('204면 anonymous + withdrawn, 토큰·작업 id를 지운다', async () => {
    const fetch = mockFetch(() => new Response(null, { status: 204 }));

    await useAuth.getState().withdraw();

    expect(fetch.mock.calls[0][0]).toBe('/api/users/me');
    expect(fetch.mock.calls[0][1]?.method).toBe('DELETE');
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: 'withdrawn' });
    expect(getAccessToken()).toBeNull();
    expect(store.has('ssaplash.chartJob.v1')).toBe(false);
  });

  it('401이면 탈퇴로 보지 않는다: 던지고 session_expired로 내리며 작업 id는 남긴다', async () => {
    mockFetch(() => problem(401, 'UNAUTHORIZED'));

    await expect(useAuth.getState().withdraw()).rejects.toMatchObject({ status: 401 });

    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: 'session_expired' });
    expect(getAccessToken()).toBeNull();
    expect(store.get('ssaplash.chartJob.v1')).toBe('job');
  });

  it('네트워크 오류면 던지고 authenticated를 유지한다', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(useAuth.getState().withdraw()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });

    expect(useAuth.getState()).toMatchObject({ status: 'authenticated', user: ME, lostReason: null });
    expect(getAccessToken()).toBe('tok');
    expect(store.get('ssaplash.chartJob.v1')).toBe('job');
  });

  it('500이면 던지고 authenticated를 유지한다', async () => {
    mockFetch(() => problem(500, 'INTERNAL'));

    await expect(useAuth.getState().withdraw()).rejects.toMatchObject({ status: 500 });

    expect(useAuth.getState()).toMatchObject({ status: 'authenticated', user: ME });
    expect(getAccessToken()).toBe('tok');
    expect(store.get('ssaplash.chartJob.v1')).toBe('job');
  });
});

describe('startLogin / consumeReturnTo', () => {
  function stubBrowser(opts: { brokenStorage?: boolean } = {}) {
    const store = new Map<string, string>();
    const broken = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('sessionStorage', {
      getItem: opts.brokenStorage ? broken : (k: string) => store.get(k) ?? null,
      setItem: opts.brokenStorage ? broken : (k: string, v: string) => void store.set(k, v),
      removeItem: opts.brokenStorage ? broken : (k: string) => void store.delete(k),
    });
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    return { store, assign };
  }

  it('돌아갈 경로를 sessionStorage에 두고 BE 로그인 시작 주소로 브라우저를 보낸다', () => {
    const { store, assign } = stubBrowser();
    useAuth.getState().startLogin('google', '/setup');
    expect(store.get(RETURN_TO_KEY)).toBe('/setup');
    expect(assign).toHaveBeenCalledWith('/api/auth/google/login');
  });

  it('외부 URL·로그인 화면은 홈으로 바꿔 저장한다', () => {
    const { store } = stubBrowser();
    useAuth.getState().startLogin('ssafy', 'https://evil.example');
    expect(store.get(RETURN_TO_KEY)).toBe('/');
    useAuth.getState().startLogin('ssafy', '/login?error=x');
    expect(store.get(RETURN_TO_KEY)).toBe('/');
  });

  it('consumeReturnTo는 꺼낸 뒤 지우고, 없으면 홈', () => {
    const { store } = stubBrowser();
    store.set(RETURN_TO_KEY, '/play?song=a');
    expect(useAuth.getState().consumeReturnTo()).toBe('/play?song=a');
    expect(store.has(RETURN_TO_KEY)).toBe(false);
    expect(useAuth.getState().consumeReturnTo()).toBe('/');
  });

  it('저장된 값이 외부 URL이면 홈', () => {
    const { store } = stubBrowser();
    store.set(RETURN_TO_KEY, '//evil.example');
    expect(useAuth.getState().consumeReturnTo()).toBe('/');
  });

  it('sessionStorage를 쓸 수 없어도 로그인 이동은 하고 복귀는 홈', () => {
    const { assign } = stubBrowser({ brokenStorage: true });
    useAuth.getState().startLogin('google', '/setup');
    expect(assign).toHaveBeenCalledWith('/api/auth/google/login');
    expect(useAuth.getState().consumeReturnTo()).toBe('/');
  });
});

describe('clearLostReason', () => {
  it('사유만 지운다', () => {
    useAuth.setState({ status: 'anonymous', lostReason: 'session_expired' });
    useAuth.getState().clearLostReason();
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', lostReason: null });
  });
});

describe('refreshMe', () => {
  const NEW_ME: UserMe = { ...ME, nickname: '새이름' };

  it('로그인 상태가 아니면 /me를 부르지 않는다', async () => {
    const fetch = server(tokenOk, () => json(200, NEW_ME));
    await useAuth.getState().refreshMe();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('성공하면 user를 새 응답으로 바꾼다', async () => {
    server(tokenOk, () => json(200, NEW_ME));
    useAuth.setState({ status: 'authenticated', user: ME });
    await useAuth.getState().refreshMe();
    expect(useAuth.getState().user).toEqual(NEW_ME);
  });

  it('실패하면 signupCompleted=false로 내리고 던지지 않는다', async () => {
    server(tokenOk, () => problem(500, 'INTERNAL'));
    useAuth.setState({ status: 'authenticated', user: ME });
    await expect(useAuth.getState().refreshMe()).resolves.toBeUndefined();
    expect(useAuth.getState().user).toEqual({ ...ME, signupCompleted: false });
  });

  it('동시에 두 번 부르면 /me는 한 번만 간다', async () => {
    const fetch = server(tokenOk, () => json(200, NEW_ME));
    useAuth.setState({ status: 'authenticated', user: ME });
    await Promise.all([useAuth.getState().refreshMe(), useAuth.getState().refreshMe()]);
    expect(fetch.mock.calls.filter(([u]) => u === '/api/users/me')).toHaveLength(1);
  });
});

describe('submitSignupConsent', () => {
  const body = currentConsentVersions();
  const FRESH: UserMe = { ...ME, nickname: '가입완료' };

  it('로그인 상태가 아니면 보내지 않는다', async () => {
    const fetch = mockFetch(() => json(200, FRESH));
    await useAuth.getState().submitSignupConsent(body);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('성공하면 POST 본문을 보내고 user를 응답으로 바꾼다', async () => {
    const fetch = mockFetch(() => json(200, FRESH));
    useAuth.setState({ status: 'authenticated', user: { ...ME, signupCompleted: false } });

    await useAuth.getState().submitSignupConsent(body);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/users/me/signup-consent');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(useAuth.getState().user).toEqual(FRESH);
  });

  it('실패하면 던지고 user는 그대로', async () => {
    mockFetch(() => problem(400, 'VALIDATION_FAILED'));
    const before = { ...ME, signupCompleted: false };
    useAuth.setState({ status: 'authenticated', user: before });

    await expect(useAuth.getState().submitSignupConsent(body)).rejects.toMatchObject({ status: 400 });
    expect(useAuth.getState().user).toEqual(before);
  });
});
