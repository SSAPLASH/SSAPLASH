import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout } from '@/components/shell/PublicLayout';
import { AppShell } from './AppShell';
import { RequireAdmin } from '@/components/shell/account/RequireAdmin';
import { RequireAuth } from '@/components/shell/account/RequireAuth';
import { FreePlayPage } from '@/features/free/FreePlayPage';
import { NotFoundPage } from '@/components/shell/NotFoundPage';
import { RouteErrorBoundary } from '@/components/shell/RouteErrorBoundary';
import { AuthCallbackPage } from '@/features/landing/AuthCallbackPage';
import { AUTH_REQUIRED } from '@/config/auth';
import { loadRoute } from './routeModules';

// 지연 로드 규칙: 새 화면은 routeModules 표에 추가하고 여기서 lazy로 연결한다. 첫 진입 화면(자유 연습·콜백)만 정적 import.
// Suspense 경계는 AppShell·PublicLayout에 있다(fallback null)
const SetupPage = lazy(() => loadRoute('setup'));
const PlayPage = lazy(() => loadRoute('play'));
const SheetPage = lazy(() => loadRoute('sheet'));
const LessonReadPage = lazy(() => loadRoute('lessonRead'));
const MiniListPage = lazy(() => loadRoute('miniList'));
const SpeedGamePage = lazy(() => loadRoute('miniSpeed'));
const StudioPage = lazy(() => loadRoute('studio'));
const SettingsPage = lazy(() => loadRoute('settings'));
const HistoryPage = lazy(() => loadRoute('history'));
const ResultPage = lazy(() => loadRoute('result'));
const ReportPage = lazy(() => loadRoute('report'));
const AdminSongsPage = lazy(() => loadRoute('adminSongs'));
/** 랜딩(`/`·`/login`·`/signup`·`/welcome`). 로그인 사용자는 쓰지 않으므로 메인 청크에 넣지 않는다 */
const LandingPage = lazy(() => loadRoute('landing'));
/** 악보 뷰어. pdf.js가 이 라우트 청크에만 들어가도록 지연 로드한다(설계 CHART-001 D12) */
const SheetViewerPage = lazy(() => loadRoute('sheetViewer'));

/** 스틱 패킷 모니터(EMB용 숨김 페이지). VITE_MONITOR=true 빌드에만 라우트·코드가 들어간다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';
// 삼항으로 감싸야 미설정 빌드에서 dynamic import가 통째로 제거돼 청크가 만들어지지 않는다
const StickMonitorPage = MONITOR_ENABLED
  ? lazy(() => import('@/features/monitor/StickMonitorPage').then((m) => ({ default: m.StickMonitorPage })))
  : null;

/** FX 랩(개발 전용, 설계 MODE-002-hit-fx-theme D7). 개발 서버에서만 라우트·청크가 생긴다 */
const FxLabPage = import.meta.env.DEV
  ? lazy(() => import('@/features/dev/FxLabPage').then((m) => ({ default: m.FxLabPage })))
  : null;

export default function App() {
  return (
    <Routes>
      {/* 개발 전용 FX 랩 — 인증·셸 없이 전체 폭으로 열어 흡수할 경계가 없으므로 Suspense를 직접 둔다 */}
      {FxLabPage && (
        <Route
          path="dev/fx"
          element={
            <Suspense fallback={null}>
              <FxLabPage />
            </Suspense>
          }
        />
      )}
      {/* 랜딩 + 로그인·가입 동의 팝업 — 셸·PublicLayout 없이 전체 화면. 주소로 팝업을 정한다(설계 UX-353) */}
      {['/', '/login', '/signup', '/welcome'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <RouteErrorBoundary resetKey={path}>
              <Suspense fallback={null}>
                <LandingPage />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
      ))}
      {/* 로그인 전에도 열리는 화면 */}
      <Route element={<PublicLayout />}>
        <Route path="auth/callback" element={<AuthCallbackPage />} />
      </Route>
      <Route element={<AppShell authRequired={AUTH_REQUIRED} />}>
        {/* 나머지는 로그인 필요 (VITE_AUTH_REQUIRED=false면 통과) */}
        <Route element={<RequireAuth required={AUTH_REQUIRED} />}>
          <Route path="setup" element={<SetupPage />} />
          <Route path="calibration" element={<Navigate to="/setup" replace />} />
          <Route path="play" element={<PlayPage />} />
          {/* 미니게임(MODE-006). `/play` 아래라 사이드바 「리듬 게임」이 활성으로 남는다. 안내·카운트다운·플레이·결과는 게임 경로 안의 단계다 */}
          <Route path="play/mini" element={<MiniListPage />} />
          <Route path="play/mini/speed" element={<SpeedGamePage />} />
          <Route path="free" element={<FreePlayPage />} />
          <Route path="sheet" element={<SheetPage />} />
          <Route path="sheet/lesson/:songId" element={<LessonReadPage />} />
          <Route path="studio" element={<StudioPage />} />
          {/* 악보 뷰어 */}
          <Route path="studio/sheets/:id" element={<SheetViewerPage />} />
          <Route path="me" element={<Navigate to="/settings" replace />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="result/:playId" element={<ResultPage />} />
          <Route path="result/:playId/report" element={<ReportPage />} />
          {/* 관리자 전용(Jira 262). 화면만 숨기고 권한은 BE가 판단한다 */}
          <Route element={<RequireAdmin />}>
            <Route path="admin/songs" element={<AdminSongsPage />} />
          </Route>
          {/* 모니터 화면의 Suspense는 AppShell 경계가 맡는다 */}
          {StickMonitorPage && (
            <Route path="monitor/stick" element={<StickMonitorPage />} />
          )}
          {/* 나머지 주소는 404 화면(설계 TECH-364). 로그인하지 않았으면 다른 보호 화면처럼 로그인으로 간다 */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
