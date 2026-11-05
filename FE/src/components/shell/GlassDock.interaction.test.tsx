// @vitest-environment happy-dom
// Dock 접힘 ↔ 펼침: 같은 toolbar 요소가 유지되고 안쪽 내용만 바뀌는지 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { MemoryRouter } from 'react-router-dom';
import MotionProvider from '@/app/MotionProvider';
import { useSettings } from '@/store/settingsStore';
import { GlassDock } from './GlassDock';

// Node 실험적 localStorage가 happy-dom 것을 가려 persist 저장이 실패한다 — import 전에 메모리 저장소로 대체한다
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

afterEach(cleanup);
beforeEach(() => {
  // happy-dom은 Web Animations가 불완전하다 — 애니메이션을 건너뛰고 결과 DOM만 검증한다
  MotionGlobalConfig.skipAnimations = true;
  useSettings.getState().setDockCollapsed(true);
});

describe('GlassDock 접힘·펼침', () => {
  it('알약 클릭 → 펼침, 접기 클릭 → 알약, toolbar는 같은 DOM 노드', async () => {
    const user = userEvent.setup();
    render(
      <MotionProvider>
        <MemoryRouter>
          <GlassDock />
        </MemoryRouter>
      </MotionProvider>,
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Dock' });
    expect(toolbar.className).toContain('collapsed');

    await user.click(screen.getByRole('button', { name: 'Dock 펼치기' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dock 접기' })).toBeTruthy());
    expect(screen.getByRole('toolbar', { name: 'Dock' })).toBe(toolbar);
    expect(toolbar.className).not.toContain('collapsed');

    await user.click(screen.getByRole('button', { name: 'Dock 접기' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dock 펼치기' })).toBeTruthy());
    expect(screen.getByRole('toolbar', { name: 'Dock' })).toBe(toolbar);
    expect(toolbar.className).toContain('collapsed');
  });
});
