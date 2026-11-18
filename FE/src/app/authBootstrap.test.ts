import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPlayLogOwner, bootstrapAuth } from './authBootstrap';
import { loadPlayLogs, savePlayLog, setPlayLogOwner } from '@/engine/playLog';
import type { PlayLog } from '@/domain/play/playLog';
import { resetAuthStoreForTest, useAuth } from '@/store/authStore';
import { REFRESH_RETRY_DELAY_MS, refreshAccessToken, resetForTest } from '@/api/account/auth';
import type { UserMe } from '@/domain/account/auth';

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const ME: UserMe = {
  id: 1,
  provider: 'SSAFY',
  nickname: '사용자',
  profileImageUrl: null,
  role: 'USER',
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
  dataConsent: { agreed: null, version: null, updatedAt: null },
  signupCompleted: true,
  consents: { terms: null, privacy: null },
};

beforeEach(() => {
  resetForTest();
  resetAuthStoreForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bootstrapAuth', () => {
  it('앱 시작 때 복원을 시작한다', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === '/api/auth/refresh'
        ? json(200, { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 1800 })
        : json(200, ME),
    );
    vi.stubGlobal('fetch', fetch);

    bootstrapAuth();
    expect(useAuth.getState().status).toBe('restoring');
    await vi.waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));

    expect(useAuth.getState().user).toEqual(ME);
  });

  it('로그인한 뒤 refresh가 실패해 토큰이 없어지면 세션 소실로 내린다', async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/refresh') {
          // 첫 호출(시작 복원)은 성공, 그 뒤는 401
          return n++ === 0
            ? json(200, { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 1800 })
            : json(401, { status: 401, code: 'UNAUTHORIZED', detail: 'x' }, 'application/problem+json');
        }
        return json(200, ME);
      }),
    );

    bootstrapAuth();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));

    const p = refreshAccessToken();
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    await p;

    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', user: null, lostReason: 'session_expired' });
  });
});

describe('bindPlayLogOwner', () => {
  /** 메모리 localStorage. 키 목록을 확인할 수 있게 data를 돌려준다 */
  function stubStorage() {
    const data: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
      removeItem: (k: string) => {
        delete data[k];
      },
    });
    return data;
  }
  const logOf = (playId: string) => ({ playId, notes: [], hits: [] }) as unknown as PlayLog;
  let unbind: () => void = () => {};
  afterEach(() => {
    unbind();
    setPlayLogOwner(null);
  });

  it('로그인 계정별로 기록을 나누고 로그아웃하면 계정 기록을 보지 않는다', () => {
    const data = stubStorage();
    unbind = bindPlayLogOwner();
    useAuth.setState({ status: 'authenticated', user: ME });
    savePlayLog(logOf('a'));
    expect(Object.keys(data)).toEqual(['ssaplash.playlogs.u1']);

    useAuth.setState({ status: 'authenticated', user: { ...ME, id: 2 } });
    expect(loadPlayLogs()).toEqual([]);

    useAuth.setState({ status: 'anonymous', user: null });
    expect(loadPlayLogs()).toEqual([]);
  });

  it('탈퇴로 내려가면 그 계정의 로컬 기록을 지운다', () => {
    const data = stubStorage();
    unbind = bindPlayLogOwner();
    useAuth.setState({ status: 'authenticated', user: ME });
    savePlayLog(logOf('a'));
    useAuth.setState({ status: 'authenticated', user: { ...ME, id: 2 } });
    savePlayLog(logOf('b'));

    useAuth.setState({ status: 'anonymous', user: null, lostReason: 'withdrawn' });
    expect(Object.keys(data)).toEqual(['ssaplash.playlogs.u1']);
  });

  it('세션 만료로 내려가면 기록을 지우지 않는다', () => {
    const data = stubStorage();
    unbind = bindPlayLogOwner();
    useAuth.setState({ status: 'authenticated', user: ME });
    savePlayLog(logOf('a'));
    useAuth.getState().sessionLost();
    expect(Object.keys(data)).toEqual(['ssaplash.playlogs.u1']);
  });

  it('탈퇴 요청이 401이면 탈퇴가 아니라 세션 만료라 기록을 지우지 않는다', async () => {
    const data = stubStorage();
    // DELETE는 401, refresh도 401 → 토큰 소실
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { status: 401, code: 'UNAUTHORIZED', detail: 'x' }, 'application/problem+json')),
    );
    vi.useFakeTimers();
    resetForTest('tok');
    unbind = bindPlayLogOwner();
    useAuth.setState({ status: 'authenticated', user: ME });
    savePlayLog(logOf('a'));

    const p = useAuth.getState().withdraw();
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    await expect(p).rejects.toMatchObject({ status: 401 });

    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', lostReason: 'session_expired' });
    expect(Object.keys(data)).toEqual(['ssaplash.playlogs.u1']);
  });
});
