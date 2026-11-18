// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_GUARD_KEY } from '@/config/chunkRecovery';
import { RouteErrorBoundary } from './RouteErrorBoundary';

function Thrower({ message }: { message: string }): never {
  throw new Error(message);
}

const CHUNK_MSG = 'Failed to fetch dynamically imported module: /assets/a.js';

describe('RouteErrorBoundary', () => {
  let reload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    // React가 오류 경계에서 찍는 콘솔 오류를 숨긴다
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('청크 오류인데 가드에 걸리면 새 버전 안내와 새로고침 버튼', async () => {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ path: window.location.pathname, at: Date.now() }));
    render(
      <RouteErrorBoundary resetKey="/a">
        <Thrower message={CHUNK_MSG} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '새 버전이 있어요' })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('청크 오류 첫 실패는 자동 새로고침하고 아무것도 그리지 않는다', () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Thrower message={CHUNK_MSG} />
      </RouteErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('일반 오류는 일반 안내이고 자동 새로고침하지 않는다', () => {
    render(
      <RouteErrorBoundary resetKey="/a">
        <Thrower message="boom" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('heading', { level: 2, name: '화면을 불러오지 못했어요' })).toBeTruthy();
    expect(screen.getByText('새로고침해 주세요. 계속되면 알려 주세요.')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('resetKey가 바뀌면 자식을 다시 그린다', () => {
    function Child({ fail }: { fail: boolean }) {
      if (fail) throw new Error('boom');
      return <p>정상 화면</p>;
    }
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/a">
        <Child fail />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(
      <RouteErrorBoundary resetKey="/b">
        <Child fail={false} />
      </RouteErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('정상 화면')).toBeTruthy();
  });
});
