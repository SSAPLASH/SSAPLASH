import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { bootstrapInput, unlockAudio } from './app/bootstrap';
import './styles/global.css';

bootstrapInput();
// 첫 클릭/키 입력에서 AudioContext를 깨운다 (브라우저 자동재생 정책)
const unlock = () => {
  void unlockAudio();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
