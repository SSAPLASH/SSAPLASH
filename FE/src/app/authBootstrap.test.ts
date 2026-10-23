import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAuth } from './authBootstrap';
import { resetAuthStoreForTest, useAuth } from '@/store/authStore';
import { REFRESH_RETRY_DELAY_MS, refreshAccessToken, resetForTest } from '@/api/auth';
import type { UserMe } from '@/domain/auth';

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
