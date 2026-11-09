import type { ComponentType } from 'react';

/** 화면 모듈 형태. React.lazy가 받는 모양과 같다 */
type RouteModule = { default: ComponentType };

/**
 * 지연 로드 화면 import 표.
 * 페이지는 named export라 default로 바꿔 준다. 새 지연 화면은 여기에 추가한다.
 * React·라우터를 import하지 않는다(타입 제외) — 미리 받기 등 다른 모듈이 이 파일만 가져다 쓴다.
 */
const routeImports = {
  setup: () => import('@/pages/SetupPage').then((m) => ({ default: m.SetupPage })),
  play: () => import('@/pages/PlayPage').then((m) => ({ default: m.PlayPage })),
  sheet: () => import('@/pages/SheetPage').then((m) => ({ default: m.SheetPage })),
  studio: () => import('@/pages/StudioPage').then((m) => ({ default: m.StudioPage })),
  settings: () => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
  history: () => import('@/pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
  result: () => import('@/pages/ResultPage').then((m) => ({ default: m.ResultPage })),
  report: () => import('@/pages/ReportPage').then((m) => ({ default: m.ReportPage })),
  adminSongs: () => import('@/pages/AdminSongsPage').then((m) => ({ default: m.AdminSongsPage })),
  signup: () => import('@/pages/SignupPage').then((m) => ({ default: m.SignupPage })),
  /** 악보 뷰어. pdf.js가 이 화면 청크에만 들어간다 */
  sheetViewer: () => import('@/pages/SheetViewerPage').then((m) => ({ default: m.SheetViewerPage })),
} satisfies Record<string, () => Promise<RouteModule>>;

export type RouteKey = keyof typeof routeImports;

/** 키마다 import Promise를 한 번만 만들어 둔다 */
const cache = new Map<RouteKey, Promise<RouteModule>>();

/**
 * 화면 모듈을 불러온다. 같은 키는 같은 Promise를 돌려준다.
 * 실패하면 캐시에서 지워 다음 호출이 다시 시도하게 하고, 에러는 그대로 던진다.
 */
export function loadRoute(key: RouteKey): Promise<RouteModule> {
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = routeImports[key]().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}
