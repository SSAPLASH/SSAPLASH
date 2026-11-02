import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout } from '@/components/shell/PublicLayout';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
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
import { AuthCallbackPage } from '@/pages/AuthCallbackPage';
import { AUTH_REQUIRED } from './authBootstrap';

/** 스틱 패킷 모니터(EMB용 숨김 페이지). VITE_MONITOR=true 빌드에만 라우트·코드가 들어간다 */
const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';
// 삼항으로 감싸야 미설정 빌드에서 dynamic import가 통째로 제거돼 청크가 만들어지지 않는다
const StickMonitorPage = MONITOR_ENABLED
  ? lazy(() => import('@/pages/monitor/StickMonitorPage').then((m) => ({ default: m.StickMonitorPage })))
  : null;

export default function App() {
  return (
    <Routes>
      {/* 로그인 전에도 열리는 화면 — 셸 없이 전체 화면 */}
      <Route element={<PublicLayout />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="auth/callback" element={<AuthCallbackPage />} />
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
          <Route path="me" element={<Navigate to="/settings" replace />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="result/:playId" element={<ResultPage />} />
          <Route path="result/:playId/report" element={<ReportPage />} />
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
