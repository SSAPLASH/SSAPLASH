// 연주 중 Dock 자동 접힘(UX-41) 상태기계. React·DOM에 의존하지 않아 가짜 타이머로 테스트한다.
// 사용자가 저장한 접힘 설정(settingsStore.dockCollapsed)은 건드리지 않고, 연주 중에만 이 로컬 상태를 쓴다.

/** 알약을 펼친 뒤 입력이 없으면 다시 접기까지의 시간(ms) */
export const DOCK_AUTO_COLLAPSE_MS = 3000;

export interface DockAutoCollapse {
  /** 접힘 상태 변화를 구독한다. 해제 함수는 타이머도 함께 정리한다 */
  subscribe: (listener: (collapsed: boolean) => void) => () => void;
  /** 연주 진행 여부. true가 되면 접고, false면 타이머만 멈춘다 */
  setActive: (active: boolean) => void;
  /** 메트로놈 패널이 열려 있는 동안은 타이머가 접지 않는다. 닫히면 타이머를 다시 시작한다 */
  setPanelOpen: (open: boolean) => void;
  /** 알약 클릭: 펼치고 타이머 시작 */
  expand: () => void;
  /** 접기 버튼: 즉시 접음 */
  collapse: () => void;
  /** Dock 안 입력(pointerdown·keydown·focus): 펼쳐진 동안 타이머를 다시 시작 */
  touch: () => void;
}

export function createDockAutoCollapse(delayMs: number = DOCK_AUTO_COLLAPSE_MS): DockAutoCollapse {
  let collapsed = true;
  let active = false;
  let panelOpen = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let listener: ((collapsed: boolean) => void) | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const set = (next: boolean) => {
    if (collapsed === next) return;
    collapsed = next;
    listener?.(collapsed);
  };
  const arm = () => {
    clear();
    if (!active || collapsed || panelOpen) return;
    timer = setTimeout(() => {
      timer = null;
      set(true);
    }, delayMs);
  };

  return {
    subscribe(l) {
      listener = l;
      l(collapsed);
      return () => {
        if (listener === l) listener = null;
        clear();
      };
    },
    setActive(next) {
      active = next;
      clear();
      if (next) set(true);
    },
    setPanelOpen(open) {
      panelOpen = open;
      arm();
    },
    expand() {
      set(false);
      arm();
    },
    collapse() {
      clear();
      set(true);
    },
    touch() {
      if (!collapsed) arm();
    },
  };
}
