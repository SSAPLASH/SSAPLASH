// @vitest-environment happy-dom
// 셸 Dock 노출 범위(QA 352 Q8·Q9): 화면이 useDock으로 켠 동안만 Dock을 두고, 꺼지면 Dock에서 켠 메트로놈을 멈춘다.
// 일시정지 팝업(useDockRaised)이 떠 있으면 Dock에 raised 클래스가 붙는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { act } from 'react';
import { AppShell } from './AppShell';
import { metronome } from '@/engine/Metronome';
import { useLive } from '@/store/liveStore';
import { useShellStore } from '@/store/shellStore';
import { useDock, useDockRaised } from '@/components/shell/nav/useShell';

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
vi.mock('@/components/shell/nav/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/shell/nav/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/shell/dock/GlassDock', () => ({ GlassDock: () => <div role="toolbar" aria-label="Dock" /> }));
vi.mock('@/components/shell/account/ProfileMenu', () => ({ ProfileMenu: () => null }));
vi.mock('@/components/shell/dock/StickStatusIndicator', () => ({ StickStatusIndicator: () => null }));
vi.mock('@/components/shell/useMediaQuery', () => ({ useSidebarCollapsed: () => false }));
vi.mock('@/components/recording/SaveRecordingDialog', () => ({ SaveRecordingDialog: () => null }));
vi.mock('@/components/recording/RecordingToast', () => ({ RecordingToast: () => null }));
vi.mock('@/components/shell/DebugOverlay', () => ({ DebugOverlay: () => null }));

let go: (to: string) => void = () => {};
function Nav() {
  go = useNavigate();
  return null;
}

// 실제 화면처럼 스위치를 켜는 시험용 화면. 켜는 경로: /free(항상)·/play(연주 단계라고 가정). 그 밖은 켜지 않는다
const ON_PATHS = new Set(['/free', '/play']);
function Screen() {
  useDock(ON_PATHS.has(useLocation().pathname));
  return <div>화면</div>;
}
function Raiser() {
  useDockRaised();
  return null;
}

function setup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
      <Routes>
        <Route element={<AppShell authRequired={false} />}>
          <Route path="*" element={<Screen />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const dock = () => screen.queryByRole('toolbar', { name: 'Dock' });

beforeEach(() => {
  useShellStore.setState({ immersive: false, dock: false, dockRaised: false });
  useLive.setState({ metronome: { ...useLive.getState().metronome, playing: false, locked: false } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('셸 Dock 노출 범위', () => {
  it('자유 연습처럼 스위치를 켠 화면에서는 Dock이 보인다', () => {
    setup('/free');
    expect(dock()).not.toBeNull();
  });

  it('스위치를 켜지 않은 화면(게임 곡 선택·준비, 그 밖 화면)에는 /play·/sheet 경로여도 Dock이 없다', () => {
    for (const path of ['/sheet', '/studio', '/history', '/settings', '/setup']) {
      setup(path);
      expect(dock()).toBeNull();
      cleanup();
    }
  });

  it('연주 단계(스위치 켬)에서는 Dock이 보이고, 단계가 끝나(스위치 꺼짐) 사라진다', () => {
    setup('/play');
    expect(dock()).not.toBeNull();
    act(() => useShellStore.getState().setDock(false));
    expect(dock()).toBeNull();
  });

  it('화면을 떠나면 Dock에서 켠 메트로놈을 멈춘다', () => {
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
    expect(dock()).toBeNull();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('일시정지 중 Dock 승격(Q9)', () => {
  it('팝업(useDockRaised)이 마운트된 동안만 Dock에 raised 클래스가 붙는다', () => {
    setup('/play');
    const wrap = () => document.querySelector('.shell-dock');
    expect(wrap()?.classList.contains('raised')).toBe(false);
    const { unmount } = render(<Raiser />);
    expect(wrap()?.classList.contains('raised')).toBe(true);
    unmount();
    expect(wrap()?.classList.contains('raised')).toBe(false);
  });
});
