// @vitest-environment happy-dom
// 모르는 주소 → 404 화면(설계 TECH-364 4-1). 셸·지연 화면은 비우고 라우트 표의 갈림만 본다.
import { cleanup, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserMe } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';
import App from './App';

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

vi.mock('./AppShell', () => ({ AppShell: () => <Outlet /> }));
vi.mock('@/components/shell/PublicLayout', () => ({ PublicLayout: () => <Outlet /> }));
vi.mock('@/features/free/FreePlayPage', () => ({ FreePlayPage: () => <div>화면:free</div> }));
vi.mock('@/features/landing/AuthCallbackPage', () => ({ AuthCallbackPage: () => <div>화면:callback</div> }));
vi.mock('./routeModules', () => ({
  loadRoute: (key: string) => Promise.resolve({ default: () => <div>화면:{key}</div> }),
}));

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </MemoryRouter>,
  );
}

describe('모르는 주소', () => {
  afterEach(() => {
    cleanup();
    useAuth.setState({ status: 'unknown', user: null, lostReason: null });
  });

  it.each(['/abc', '/studio/abc', '/play/x', '/result'])('로그인 상태 %s → 404 화면과 [자유 연습으로]', async (path) => {
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    open(path);
    expect(await screen.findByRole('heading', { level: 2, name: '페이지를 찾을 수 없어요' })).toBeTruthy();
    expect(screen.getByText('주소가 바뀌었거나 없는 페이지예요.')).toBeTruthy();
    expect(screen.getByRole('link', { name: '자유 연습으로' }).getAttribute('href')).toBe('/free');
  });

  it.each([
    ['/free', 'free'],
    ['/play', 'play'],
    ['/studio', 'studio'],
    ['/studio/sheets/3', 'sheetViewer'],
    ['/result/p1', 'result'],
    ['/result/p1/report', 'report'],
  ])('기존 경로 %s는 404로 가지 않는다', async (path, key) => {
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    open(path);
    expect(await screen.findByText(`화면:${key}`)).toBeTruthy();
    expect(screen.queryByText('페이지를 찾을 수 없어요')).toBeNull();
  });

  it('로그인하지 않았으면 404 대신 로그인(랜딩)으로 간다', async () => {
    useAuth.setState({ status: 'anonymous', user: null });
    open('/abc');
    expect(await screen.findByText('화면:landing')).toBeTruthy();
    expect(screen.queryByText('페이지를 찾을 수 없어요')).toBeNull();
  });
});
