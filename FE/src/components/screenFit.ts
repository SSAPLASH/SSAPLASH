// 연주 화면(/sheet·/play) 사용 조건: 가로 방향이면서 폭 PLAY_MIN_WIDTH_PX 이상.
// 순수 판정(screenFits)과 미디어 쿼리(SCREEN_FIT_QUERY)는 같은 기준이어야 한다. 정사각형은 통과시킨다.
import { useSyncExternalStore } from 'react';

/** 연주 화면을 쓸 수 있는 최소 뷰포트 폭(px) */
export const PLAY_MIN_WIDTH_PX = 640;

/** 가로 방향(폭 ≥ 높이, 정사각형 포함)이고 폭이 최소 폭 이상이면 참 */
export function screenFits(width: number, height: number): boolean {
  return width >= height && width >= PLAY_MIN_WIDTH_PX;
}

/** screenFits와 같은 기준의 미디어 쿼리. orientation: landscape는 정사각형을 빼므로 min-aspect-ratio를 쓴다 */
export const SCREEN_FIT_QUERY = `(min-aspect-ratio: 1/1) and (min-width: ${PLAY_MIN_WIDTH_PX}px)`;

function getMql(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(SCREEN_FIT_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const mql = getMql();
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return getMql()?.matches ?? true;
}

/** 화면이 연주 조건을 만족하는지. 첫 렌더부터 실제 값이고, matchMedia가 없으면 참 */
export function useScreenFits(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
