// 랜딩 모드 ↔ 경로, 주소 → 팝업 종류 판정 (설계 UX-353 3장). React·store에 의존하지 않는 순수 함수.

/** 랜딩 모드 키. components/landing/landingContent의 LandingModeKey와 같은 값이다(도메인은 컴포넌트를 import하지 않는다) */
export type LandingRouteMode = 'free' | 'sheet' | 'game';

const MODE_ROUTES: Record<LandingRouteMode, string> = {
  free: '/free',
  sheet: '/sheet',
  game: '/play',
};

/** 모드 키 → 앱 경로 */
export function modeRoute(key: LandingRouteMode): string {
  return MODE_ROUTES[key];
}

/** 경로 → 모드 키. 모드 경로가 아니면 null (팝업 안내 문구용) */
export function modeForRoute(path: string): LandingRouteMode | null {
  for (const key of Object.keys(MODE_ROUTES) as LandingRouteMode[]) {
    if (MODE_ROUTES[key] === path) return key;
  }
  return null;
}

export type LandingDialogKind = 'none' | 'login' | 'signup';

/** 주소 → 랜딩 위에 열 팝업 종류 */
export function landingDialog(pathname: string): LandingDialogKind {
  if (pathname === '/login') return 'login';
  if (pathname === '/signup') return 'signup';
  return 'none';
}
