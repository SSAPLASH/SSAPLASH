// 셸(사이드바·TopBar·Dock) 표시 상태. 페이지가 useShell로 알리고 셸이 읽는다. 영속하지 않는다.
// 사이드바 접힘·Dock 접힘은 settingsStore에 영속한다.
import { create } from 'zustand';

export type DockPanel = 'metronome' | null;

interface ShellState {
  /** TopBar 제목 */
  title: string;
  /** 전체 화면 연주 여부. true면 사이드바·TopBar를 그리지 않는다 */
  immersive: boolean;
  /** 열려 있는 Dock 패널. 한 번에 하나 */
  dockPanel: DockPanel;
  /** 카운트인이 끝나 곡이 실제로 진행 중인지(일시정지·종료 때 false). Dock 자동 접힘(UX-41)이 읽는다 */
  playRunning: boolean;
  /** Dock을 그릴지. 화면이 useDock으로 켠다(자유 연습 · 게임·악보의 연주 단계). 경로 판정이 아니다 */
  dock: boolean;
  /** 일시정지·끊김 팝업이 떠 있어 Dock을 스크림 위로 올려야 하는지(PauseOverlay가 useDockRaised로 켠다) */
  dockRaised: boolean;

  setShell: (partial: { title?: string; immersive?: boolean }) => void;
  setDockPanel: (p: DockPanel) => void;
  setPlayRunning: (running: boolean) => void;
  setDock: (v: boolean) => void;
  setDockRaised: (v: boolean) => void;
}

export const useShellStore = create<ShellState>()((set) => ({
  title: '',
  immersive: false,
  dockPanel: null,
  playRunning: false,
  dock: false,
  dockRaised: false,

  setShell: (partial) => set(partial),
  setDockPanel: (dockPanel) => set({ dockPanel }),
  setPlayRunning: (playRunning) => set({ playRunning }),
  setDock: (dock) => set({ dock }),
  setDockRaised: (dockRaised) => set({ dockRaised }),
}));
