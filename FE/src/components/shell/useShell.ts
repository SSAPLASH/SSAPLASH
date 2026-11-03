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
