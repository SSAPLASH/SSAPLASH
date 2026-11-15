// 악보 연습 킷 상자 훅: 창 크기가 바뀌면 다시 계산한다. window가 없으면 최소 크기(예전 고정값)로 본다.
import { useMemo, useSyncExternalStore } from 'react';
import { sheetKitFit } from './sheetKitFit';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}
const width = () => (typeof window === 'undefined' ? 0 : window.innerWidth);
const height = () => (typeof window === 'undefined' ? 0 : window.innerHeight);
const zero = () => 0;

export function useSheetKitFit(): { width: number; height: number } {
  const w = useSyncExternalStore(subscribe, width, zero);
  const h = useSyncExternalStore(subscribe, height, zero);
  return useMemo(() => sheetKitFit(w, h), [w, h]);
}
