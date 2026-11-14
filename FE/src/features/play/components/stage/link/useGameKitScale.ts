// 리듬 게임 킷 배율 훅. 화면 높이 기준은 PlayStage.css의 미디어 쿼리(min-height: 820px)와 같아야 한다.
import { useSyncExternalStore } from 'react';
import { GAME_KIT_TALL_MIN_HEIGHT, gameKitScale } from './laneLinkGeometry';

const QUERY = `(min-height: ${GAME_KIT_TALL_MIN_HEIGHT}px)`;

function mql(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const m = mql();
  if (!m) return () => {};
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

/** matchMedia가 없으면 큰 화면으로 본다 */
export function useGameKitScale(): number {
  const tall = useSyncExternalStore(subscribe, () => mql()?.matches ?? true, () => true);
  return gameKitScale(tall);
}
