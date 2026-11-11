// 채보 확인 재생 컴포넌트의 지연 로드 진입점. 삼항으로 감싸 VITE_MONITOR 미설정 빌드에서는
// dynamic import가 통째로 제거돼 청크가 만들어지지 않는다(App.tsx의 StickMonitorPage와 같은 방식).
// 토글은 셸 상단에 모든 사용자에게 보이므로 개발 서버(DEV)에서만 둔다. 배포 모니터 빌드에는 없다(설계 PLAY-002 live-play-diagnostics D4).
import { lazy } from 'react';

const MONITOR_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MONITOR === 'true';

export const LazyChartAutoplayToggle = MONITOR_ENABLED
  ? lazy(() => import('./ChartAutoplayControl').then((m) => ({ default: m.ChartAutoplayToggle })))
  : null;

export const LazyChartAutoplayRunner = MONITOR_ENABLED
  ? lazy(() => import('./ChartAutoplayControl').then((m) => ({ default: m.ChartAutoplayRunner })))
  : null;
