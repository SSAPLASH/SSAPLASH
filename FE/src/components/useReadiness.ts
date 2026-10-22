// 설정·라이브 스토어에서 준비 조건을 읽어 readiness 결과를 돌려주는 훅. 안내 컴포넌트와 곡 연주 시작 차단이 함께 쓴다.
import { readiness, type ReadinessResult } from '@/domain/readiness';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

export function useReadiness(): ReadinessResult {
  const sensorKind = useSettings((s) => s.sensorKind);
  const firstSetupDone = useSettings((s) => s.firstSetupDone);
  const activePresetId = useSettings((s) => s.activePresetId);
  const connected = useLive((l) => l.connected);
  return readiness({ sensorKind, connected, firstSetupDone, activePresetId });
}
