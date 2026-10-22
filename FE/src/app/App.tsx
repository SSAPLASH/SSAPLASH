import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '@/components/shell/PublicLayout';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { HomePage } from '@/pages/HomePage';
import { SetupPage } from '@/pages/SetupPage';
import { CalibrationPage } from '@/pages/CalibrationPage';
import { PlayPage } from '@/pages/PlayPage';
import { FreePlayPage } from '@/pages/FreePlayPage';
import { ResultPage } from '@/pages/ResultPage';
import { SheetPage } from '@/pages/SheetPage';
import { LoginPage } from '@/pages/LoginPage';
import { AuthCallbackPage } from '@/pages/AuthCallbackPage';
import { AUTH_REQUIRED } from './authBootstrap';

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
          <Route index element={<HomePage />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="calibration" element={<CalibrationPage />} />
          <Route path="play" element={<PlayPage />} />
          <Route path="free" element={<FreePlayPage />} />
          <Route path="sheet" element={<SheetPage />} />
          <Route path="result/:playId" element={<ResultPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
