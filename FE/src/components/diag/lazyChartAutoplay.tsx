// 채보 확인 재생 컴포넌트의 지연 로드 진입점. 삼항으로 감싸 VITE_MONITOR 미설정 빌드에서는
// dynamic import가 통째로 제거돼 청크가 만들어지지 않는다(App.tsx의 StickMonitorPage와 같은 방식).
import { lazy } from 'react';

const MONITOR_ENABLED = import.meta.env.VITE_MONITOR === 'true';

export const LazyChartAutoplayToggle = MONITOR_ENABLED
  ? lazy(() => import('./ChartAutoplayControl').then((m) => ({ default: m.ChartAutoplayToggle })))
  : null;

export const LazyChartAutoplayRunner = MONITOR_ENABLED
  ? lazy(() => import('./ChartAutoplayControl').then((m) => ({ default: m.ChartAutoplayRunner })))
  : null;
