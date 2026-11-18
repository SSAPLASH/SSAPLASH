import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './app/App';
import MotionProvider from './app/MotionProvider';
import './app/sensors'; // 입력 소스 등록 (bootstrapInput보다 먼저)
import { bootstrapInput, bootstrapMetronome } from './app/bootstrap';
import { unlockAudio } from './runtime/audioUnlock';
import { bootstrapAuth } from './app/authBootstrap';
import { bootstrapPresets } from './app/presetBootstrap';
import { installPreloadErrorHandler } from './config/chunkRecovery';
import { queryClient } from './runtime/queryClient';
import { bindQueryCacheToAuth } from './app/queryAuthBinding';
import { useRecordingStore } from './runtime/recordingStore';
import { RouteErrorElement } from '@/components/shell/RouteErrorBoundary';
import './styles/global.css';

bootstrapInput();
bootstrapMetronome();
bootstrapPresets(); // 로그인 상태에 따라 프리셋 저장소(로컬/서버)를 맞춘다. 복원 결과보다 먼저 구독해야 한다
bindQueryCacheToAuth(queryClient); // 로그인 사용자가 바뀌면 서버 데이터 캐시를 비운다. 로그인 복원보다 먼저 구독한다
bootstrapAuth(); // refresh 쿠키로 로그인 복원 시작. 결과는 RequireAuth가 본다
// 화면 청크의 CSS·의존 청크 미리 받기 실패 시 1회 자동 새로고침(녹음 중·저장 대기 중이면 하지 않는다)
installPreloadErrorHandler(() => useRecordingStore.getState().phase !== 'idle');
// 첫 클릭/키 입력에서 AudioContext를 깨운다 (브라우저 자동재생 정책)
const unlock = () => {
  void unlockAudio();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// useBlocker(설정 페이지 이탈 확인)는 데이터 라우터에서만 동작한다. 기존 <Routes> 트리는 splat 라우트 아래에 그대로 둔다
const router = createBrowserRouter([{ path: '*', element: <App />, errorElement: <RouteErrorElement /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <RouterProvider router={router} />
      </MotionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
