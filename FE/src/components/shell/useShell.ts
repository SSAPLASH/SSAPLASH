// 페이지가 셸에 제목·전체 화면 여부를 알리는 훅.
// 마운트·인자 변경 시 shellStore에 반영하고, 언마운트(또는 인자 변경 전)에는 자기가 바꾼 필드만 기본값으로 되돌린다.
import { useEffect } from 'react';
import { useShellStore } from '@/store/shellStore';

export interface ShellOptions {
  title?: string;
  immersive?: boolean;
}

export function useShell({ title, immersive }: ShellOptions): void {
  useEffect(() => {
    if (title === undefined) return;
    useShellStore.getState().setShell({ title });
    return () => useShellStore.getState().setShell({ title: '' });
  }, [title]);

  useEffect(() => {
    if (immersive === undefined) return;
    useShellStore.getState().setShell({ immersive });
    return () => useShellStore.getState().setShell({ immersive: false });
  }, [immersive]);
}

/** 곡이 실제로 진행 중인지 셸에 알린다(Dock 자동 접힘용). 언마운트·값 변경 전에는 false로 되돌린다. */
export function usePlayRunning(running: boolean): void {
  useEffect(() => {
    if (!running) return;
    useShellStore.getState().setPlayRunning(true);
    return () => useShellStore.getState().setPlayRunning(false);
  }, [running]);
}

/**
 * active인 동안 셸이 Dock을 그린다(QA 352 Q8). 키보드 드럼(useKeyboardDrum)과 같은 방식 —
 * 경로 목록이 아니라 화면이 직접 켜고 끈다. 꺼지거나 화면을 떠나면(cleanup) 끈다.
 */
export function useDock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    useShellStore.getState().setDock(true);
    return () => useShellStore.getState().setDock(false);
  }, [active]);
}

/**
 * 마운트되어 있는 동안 Dock을 대화상자 스크림 위로 올린다(QA 352 Q9).
 * 일시정지 팝업은 마운트 = 열림이라 CSS :has() 대신 스토어 플래그로 둔다 — 메트로놈 패널은 포털로 body에 붙어
 * 셸 클래스를 못 받으므로 같은 플래그를 GlassDock이 직접 읽고, 둘 다 테스트에서 상태로 확인할 수 있다.
 */
export function useDockRaised(): void {
  useEffect(() => {
    useShellStore.getState().setDockRaised(true);
    return () => useShellStore.getState().setDockRaised(false);
  }, []);
}
