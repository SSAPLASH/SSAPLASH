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

  setShell: (partial: { title?: string; immersive?: boolean }) => void;
  setDockPanel: (p: DockPanel) => void;
}

export const useShellStore = create<ShellState>()((set) => ({
  title: '',
  immersive: false,
  dockPanel: null,

  setShell: (partial) => set(partial),
  setDockPanel: (dockPanel) => set({ dockPanel }),
}));
