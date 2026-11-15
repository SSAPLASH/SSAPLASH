// @vitest-environment happy-dom
// 메트로놈 패널(Radix Popover): 칩 클릭 열림·첫 조작 포커스·칩 고른 표시, Esc·바깥 pointerdown 닫힘, 상태 동기, 박 분할 선택·예시 소리.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { MemoryRouter } from 'react-router-dom';
import MotionProvider from '@/app/MotionProvider';
import { metronomePreview } from '@/runtime/metronomePreview';
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
  it('칩 클릭 → 열림, 첫 조작(박자에서 고른 칸)에 포커스, dockPanel 동기', async () => {
    const { user, chip } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip.getAttribute('aria-expanded')).toBe('false');

    await user.click(chip);
    const dialog = await screen.findByRole('dialog', { name: '메트로놈 설정' });
    expect(useShellStore.getState().dockPanel).toBe('metronome');
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(dialog.querySelector('[role="radio"][aria-checked="true"]')));
    expect(dialog.querySelector('[role="switch"]')).toBeNull();

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

  it('패널이 열려 있는 동안 칩 전체에 고른 표시(open)가 붙는다', async () => {
    const { user, chip } = setup();
    const group = chip.closest('.dock-metro-chip')!;
    expect(group.className).not.toContain('open');
    await user.click(chip);
    await screen.findByRole('dialog');
    expect(group.className).toContain('open');
    // 칩 안의 켜기 스위치도 같은 묶음 안에 있다
    expect(group.querySelector('[role="switch"]')).not.toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(group.className).not.toContain('open'));
  });

  it('곡 BPM이 소수여도 칩의 숫자는 정수로 보인다', () => {
    const before = useLive.getState().metronome;
    useLive.setState({ metronome: { ...before, bpm: 78.43, locked: true } });
    try {
      setup();
      expect(document.querySelector('.dock-bpm')?.textContent).toBe('78');
    } finally {
      useLive.setState({ metronome: before });
    }
  });

  it('박 분할을 고르면 설정에 저장되고 그 자리의 BPM으로 예시 소리를 부른다', async () => {
    const play = vi.spyOn(metronomePreview, 'play').mockResolvedValue();
    useSettings.getState().setMetronomeSubdivision('auto');
    const { user, chip } = setup();
    await user.click(chip);
    const dialog = await screen.findByRole('dialog');
    const bpm = useLive.getState().metronome.bpm;
    await user.click(screen.getByRole('radio', { name: '8분음표' }));
    expect(useSettings.getState().metronomeSubdivision).toBe('eighth');
    expect(play).toHaveBeenLastCalledWith('dock', bpm, 2);
    expect(dialog.textContent).toContain('박 사이에 한 번 더 울려요');
    await user.click(screen.getByRole('radio', { name: '4분음표' }));
    expect(play).toHaveBeenLastCalledWith('dock', bpm, 1);
    play.mockRestore();
    useSettings.getState().setMetronomeSubdivision('auto');
  });
});
