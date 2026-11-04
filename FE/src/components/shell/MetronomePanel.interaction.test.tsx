// @vitest-environment happy-dom
// 메트로놈 패널(Radix Popover): 칩 클릭 열림·첫 스위치 포커스, Esc·바깥 pointerdown 닫힘, 상태 동기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { MemoryRouter } from 'react-router-dom';
import MotionProvider from '@/app/MotionProvider';
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
  MotionGlobalConfig.skipAnimations = true;
  useSettings.getState().setDockCollapsed(false);
  useShellStore.getState().setDockPanel(null);
});

function setup() {
  const user = userEvent.setup();
  render(
    <MotionProvider>
      <MemoryRouter>
        <div data-testid="outside">바깥</div>
        <GlassDock />
      </MemoryRouter>
    </MotionProvider>,
  );
  const chip = screen.getByRole('button', { name: '메트로놈 설정' });
  return { user, chip };
}

describe('메트로놈 패널 Popover', () => {
  it('칩 클릭 → 열림, 첫 스위치에 포커스, dockPanel 동기', async () => {
    const { user, chip } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip.getAttribute('aria-expanded')).toBe('false');

    await user.click(chip);
    const dialog = await screen.findByRole('dialog', { name: '메트로놈 설정' });
    expect(useShellStore.getState().dockPanel).toBe('metronome');
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(dialog.querySelector('[role="switch"]')));

    // 칩을 다시 누르면 닫힌다
    await user.click(chip);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useShellStore.getState().dockPanel).toBeNull();
  });

  it('Esc → 닫힘, 포커스는 칩으로 복귀', async () => {
    const { user, chip } = setup();
    await user.click(chip);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useShellStore.getState().dockPanel).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('바깥 pointerdown → 닫힘, 패널 안 클릭은 닫히지 않음', async () => {
    const { user, chip } = setup();
    await user.click(chip);
    const dialog = await screen.findByRole('dialog');

    await user.click(dialog.querySelector('.metro-panel-title')!);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(useShellStore.getState().dockPanel).toBe('metronome');

    await user.pointer({ keys: '[MouseLeft]', target: screen.getByTestId('outside') });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useShellStore.getState().dockPanel).toBeNull();
  });

  it('Dock을 접으면 패널이 즉시 사라진다', async () => {
    const { user, chip } = setup();
    await user.click(chip);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Dock 접기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useShellStore.getState().dockPanel).toBeNull();
  });
});
