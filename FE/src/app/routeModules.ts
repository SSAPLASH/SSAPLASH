import type { ComponentType } from 'react';

/** 화면 모듈 형태. React.lazy가 받는 모양과 같다 */
type RouteModule = { default: ComponentType };

/**
 * 지연 로드 화면 import 표.
 * 페이지는 named export라 default로 바꿔 준다. 새 지연 화면은 여기에 추가한다.
 * React·라우터를 import하지 않는다(타입 제외) — 미리 받기 등 다른 모듈이 이 파일만 가져다 쓴다.
 */
const routeImports = {
  setup: () => import('@/features/setup/SetupPage').then((m) => ({ default: m.SetupPage })),
  play: () => import('@/features/play/PlayPage').then((m) => ({ default: m.PlayPage })),
  sheet: () => import('@/features/play/SheetPage').then((m) => ({ default: m.SheetPage })),
  /** 입문 코스 알아보기 레슨(Jira 331) */
  lessonRead: () => import('@/features/lesson/LessonReadPage').then((m) => ({ default: m.LessonReadPage })),
  /** 미니게임 목록과 게임 화면(MODE-006). 게임마다 화면을 하나씩 더한다 */
  miniList: () => import('@/features/mini/MiniListPage').then((m) => ({ default: m.MiniListPage })),
  miniSpeed: () => import('@/features/mini/SpeedGamePage').then((m) => ({ default: m.SpeedGamePage })),
  miniDynamics: () => import('@/features/mini/DynamicsGamePage').then((m) => ({ default: m.DynamicsGamePage })),
  miniSight: () => import('@/features/mini/SightGamePage').then((m) => ({ default: m.SightGamePage })),
  studio: () => import('@/features/studio/StudioPage').then((m) => ({ default: m.StudioPage })),
  settings: () => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
  history: () => import('@/features/history/HistoryPage').then((m) => ({ default: m.HistoryPage })),
  result: () => import('@/features/result/ResultPage').then((m) => ({ default: m.ResultPage })),
  report: () => import('@/features/result/ReportPage').then((m) => ({ default: m.ReportPage })),
  adminSongs: () => import('@/features/admin/AdminSongsPage').then((m) => ({ default: m.AdminSongsPage })),
  landing: () => import('@/features/landing/LandingPage').then((m) => ({ default: m.LandingPage })),
  /** 악보 뷰어. pdf.js가 이 화면 청크에만 들어간다 */
  sheetViewer: () => import('@/features/studio/SheetViewerPage').then((m) => ({ default: m.SheetViewerPage })),
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
