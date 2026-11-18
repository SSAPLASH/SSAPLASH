// matchMedia 구독 훅. 셸의 태블릿(≤1024) 강제 접힘 판정에 쓴다.
import { useSyncExternalStore } from 'react';
import { useSettings } from '@/store/settingsStore';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** 태블릿 폭(≤1024). 사이드바 강제 접힘·본문 여백 24 기준 */
export const TABLET_QUERY = '(max-width: 1024px)';

/** 모바일 폭(≤640). 반주 미니 바·고르기 바텀 시트 기준 */
export const MOBILE_QUERY = '(max-width: 640px)';

/** 사이드바 실제 접힘: 사용자 설정 또는 태블릿 폭. 사이드바와 Dock 위치 계산이 같은 값을 쓴다 */
export function useSidebarCollapsed(): boolean {
  const stored = useSettings((s) => s.sidebarCollapsed);
  const tablet = useMediaQuery(TABLET_QUERY);
  return stored || tablet;
}
