import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout } from '@/components/shell/PublicLayout';
import { AppShell } from '@/components/AppShell';
import { RequireAdmin } from '@/components/RequireAdmin';
import { RequireAuth } from '@/components/RequireAuth';
import { AdminSongsPage } from '@/pages/AdminSongsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { SetupPage } from '@/pages/SetupPage';
import { PlayPage } from '@/pages/PlayPage';
import { FreePlayPage } from '@/pages/FreePlayPage';
import { ResultPage } from '@/pages/ResultPage';
import { ReportPage } from '@/pages/ReportPage';
import { SheetPage } from '@/pages/SheetPage';
import { StudioPage } from '@/pages/StudioPage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { AuthCallbackPage } from '@/pages/AuthCallbackPage';
import { AUTH_REQUIRED } from './authBootstrap';

/** 악보 뷰어. pdf.js가 이 라우트 청크에만 들어가도록 지연 로드한다(설계 CHART-001 D12) */
const SheetViewerPage = lazy(() => import('@/pages/SheetViewerPage').then((m) => ({ default: m.SheetViewerPage })));

/** 스틱 패킷 모니터(EMB용 숨김 페이지). VITE_MONITOR=true 빌드에만 라우트·코드가 들어간다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';
// 삼항으로 감싸야 미설정 빌드에서 dynamic import가 통째로 제거돼 청크가 만들어지지 않는다
const StickMonitorPage = MONITOR_ENABLED
  ? lazy(() => import('@/pages/monitor/StickMonitorPage').then((m) => ({ default: m.StickMonitorPage })))
  : null;

/** FX 랩(개발 전용, 설계 MODE-002-hit-fx-theme D7). 개발 서버에서만 라우트·청크가 생긴다 */
const FxLabPage = import.meta.env.DEV
  ? lazy(() => import('@/pages/dev/FxLabPage').then((m) => ({ default: m.FxLabPage })))
  : null;

export default function App() {
  return (
    <Routes>
      {/* 개발 전용 FX 랩 — 인증·셸 없이 전체 폭으로 연다 */}
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
      {/* 로그인 전에도 열리는 화면 — 셸 없이 전체 화면 */}
      <Route element={<PublicLayout />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        {/* 가입 동의 — 페이지가 서버 가입 상태를 스스로 확인한다(설계 COACH-003-signup-consent v0.4) */}
        <Route path="signup" element={<SignupPage />} />
      </Route>
      <Route element={<AppShell authRequired={AUTH_REQUIRED} />}>
        {/* 나머지는 로그인 필요 (VITE_AUTH_REQUIRED=false면 통과) */}
        <Route element={<RequireAuth required={AUTH_REQUIRED} />}>
          <Route index element={<Navigate to="/free" replace />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="calibration" element={<Navigate to="/setup" replace />} />
          <Route path="play" element={<PlayPage />} />
          <Route path="free" element={<FreePlayPage />} />
          <Route path="sheet" element={<SheetPage />} />
          <Route path="studio" element={<StudioPage />} />
          {/* 악보 뷰어(스위치 꺼짐이면 페이지가 /studio로 보낸다) */}
          <Route
            path="studio/sheets/:id"
            element={
              <Suspense fallback={null}>
                <SheetViewerPage />
              </Suspense>
            }
          />
          <Route path="me" element={<Navigate to="/settings" replace />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="result/:playId" element={<ResultPage />} />
          <Route path="result/:playId/report" element={<ReportPage />} />
          {/* 관리자 전용(Jira 262). 화면만 숨기고 권한은 BE가 판단한다 */}
          <Route element={<RequireAdmin />}>
            <Route path="admin/songs" element={<AdminSongsPage />} />
          </Route>
          {StickMonitorPage && (
            <Route
              path="monitor/stick"
              element={
                <Suspense fallback={null}>
                  <StickMonitorPage />
                </Suspense>
              }
            />
          )}
        </Route>
      </Route>
    </Routes>
  );
}
