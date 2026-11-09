// @vitest-environment happy-dom
// 셸 Dock 노출 범위(QA 352): 연주 화면에서만 Dock을 두고, 다른 화면으로 나가면 Dock에서 켠 메트로놈을 멈춘다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { act } from 'react';
import { AppShell } from '@/components/AppShell';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';
import { useShellStore } from '@/store/shellStore';

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

// 이 테스트가 보는 것은 Dock 자리뿐이다 — 셸의 무거운 자식은 비운다
vi.mock('@/components/shell/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/shell/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/shell/GlassDock', () => ({ GlassDock: () => <div role="toolbar" aria-label="Dock" /> }));
vi.mock('@/components/shell/ProfileMenu', () => ({ ProfileMenu: () => null }));
vi.mock('@/components/shell/StickStatusIndicator', () => ({ StickStatusIndicator: () => null }));
vi.mock('@/components/shell/useMediaQuery', () => ({ useSidebarCollapsed: () => false }));
vi.mock('@/components/recording/SaveRecordingDialog', () => ({ SaveRecordingDialog: () => null }));
vi.mock('@/components/recording/RecordingToast', () => ({ RecordingToast: () => null }));
vi.mock('@/components/DebugOverlay', () => ({ DebugOverlay: () => null }));

let go: (to: string) => void = () => {};
function Nav() {
  go = useNavigate();
  return null;
}

function setup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
      <Routes>
        <Route element={<AppShell authRequired={false} />}>
          <Route path="*" element={<div>화면</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const dock = () => screen.queryByRole('toolbar', { name: 'Dock' });

beforeEach(() => {
  useShellStore.setState({ immersive: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('셸 Dock 노출 범위', () => {
  it.each(['/free', '/play', '/sheet'])('%s에서는 Dock이 보인다', (path) => {
    setup(path);
    expect(dock()).not.toBeNull();
  });

  it.each(['/studio', '/history', '/settings', '/setup'])('%s에서는 Dock이 없다', (path) => {
    setup(path);
    expect(dock()).toBeNull();
  });

  it('연주 화면에서 나가면 Dock에서 켠 메트로놈을 멈춘다', () => {
    const stop = vi.spyOn(metronome, 'stop').mockImplementation(() => {});
    setup('/free');
    act(() => useLive.setState({ metronome: { ...useLive.getState().metronome, playing: true, locked: false } }));
    expect(stop).not.toHaveBeenCalled();
    act(() => go('/studio'));
    expect(dock()).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('곡 연주에 묶인 클릭은 셸이 멈추지 않는다', () => {
    const stop = vi.spyOn(metronome, 'stop').mockImplementation(() => {});
    setup('/play');
    act(() => useLive.setState({ metronome: { ...useLive.getState().metronome, playing: true, locked: true } }));
    act(() => go('/result/1'));
    expect(stop).not.toHaveBeenCalled();
  });
});
