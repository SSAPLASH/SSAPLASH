// @vitest-environment happy-dom
// Dock 접힘 ↔ 펼침: 같은 toolbar 요소가 유지되고 안쪽 내용만 바뀌는지 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { MemoryRouter } from 'react-router-dom';
import MotionProvider from '@/app/MotionProvider';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
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
  it('» → 펼침, « → 접힘, toolbar는 같은 DOM 노드', async () => {
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

  it('접힘: 음소거·메트로놈 아이콘만 같은 크기로 남고 BPM 숫자·± 는 없다', () => {
    renderDock();
    expect(screen.getByRole('switch', { name: '패드 소리' }).className).toContain('ui-icon-btn-sm');
    expect(screen.getByRole('switch', { name: '메트로놈 재생' }).className).toContain('ui-icon-btn-sm dock-metro-mini');
    expect(screen.queryByRole('button', { name: 'BPM 5 증가' })).toBeNull();
    expect(document.querySelector('.dock-bpm')).toBeNull();
    expect(screen.queryByRole('button', { name: '일시정지' })).toBeNull();
  });

  it('리듬 게임(/play): 메트로놈 토글·BPM이 비활성이고 켜짐 표시도 없다(접힘·펼침 모두)', async () => {
    useSettings.setState({ metronome: true });
    const view = renderDock('/play');
    const mini = screen.getByRole('switch', { name: '리듬 게임에서는 메트로놈을 쓰지 않아요' }) as HTMLButtonElement;
    expect(mini.disabled).toBe(true);
    expect(mini.getAttribute('aria-checked')).toBe('false');
    view.unmount();
    useSettings.getState().setDockCollapsed(false);
    renderDock('/play');
    await waitFor(() => expect(screen.getByRole('button', { name: 'BPM 5 증가' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'BPM 5 증가' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'BPM 5 감소' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: '리듬 게임에서는 메트로놈을 쓰지 않아요' }) as HTMLButtonElement).disabled).toBe(true);
    useSettings.setState({ metronome: false });
  });

  it('악보(/sheet)에서는 메트로놈 토글이 비활성이 아니다', () => {
    renderDock('/sheet');
    expect((screen.getByRole('switch', { name: '메트로놈 재생' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('접힌 채로 패드 소리를 끄면 바로 꺼지고 Dock은 접힌 채다', async () => {
    const user = userEvent.setup();
    useSettings.getState().setSoundOn(true);
    renderDock();
    await user.click(screen.getByRole('switch', { name: '패드 소리' }));
    expect(useSettings.getState().soundOn).toBe(false);
    expect(screen.getByRole('toolbar', { name: 'Dock' }).className).toContain('collapsed');
  });

  it('연주 중 자동 접힘에서 일시정지를 누르면 일시정지 요청만 하고 펼치지 않는다', async () => {
    const user = userEvent.setup();
    useShellStore.setState({ immersive: true, playRunning: true });
    useLive.setState({ pauseRequested: null });
    try {
      renderDock();
      const toolbar = screen.getByRole('toolbar', { name: 'Dock' });
      expect(toolbar.className).toContain('collapsed');
      await user.click(screen.getByRole('button', { name: '일시정지' }));
      expect(useLive.getState().pauseRequested).toBe('menu');
      expect(toolbar.className).toContain('collapsed');
    } finally {
      useShellStore.setState({ immersive: false, playRunning: false });
    }
  });
});

function renderDock(path = '/') {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[path]}>
        <GlassDock />
      </MemoryRouter>
    </MotionProvider>,
  );
}
