import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { HomePage } from '@/pages/HomePage';
import { SetupPage } from '@/pages/SetupPage';
import { CalibrationPage } from '@/pages/CalibrationPage';
import { PlayPage } from '@/pages/PlayPage';
import { FreePlayPage } from '@/pages/FreePlayPage';
import { ResultPage } from '@/pages/ResultPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="calibration" element={<CalibrationPage />} />
        <Route path="play" element={<PlayPage />} />
        <Route path="free" element={<FreePlayPage />} />
        <Route path="result/:playId" element={<ResultPage />} />
      </Route>
    </Routes>
  );
}
