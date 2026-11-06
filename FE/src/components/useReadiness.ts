// 설정·라이브 스토어에서 준비 조건을 읽어 readiness 결과를 돌려주는 훅. 안내 컴포넌트와 곡 연주 시작 차단이 함께 쓴다.
import { anchorsReady, readiness, type ReadinessResult } from '@/domain/readiness';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

export function useReadiness(): ReadinessResult {
  const sensorKind = useSettings((s) => s.sensorKind);
  const firstSetupDone = useSettings((s) => s.firstSetupDone);
  const anchors = useSettings((s) => s.stickAnchors);
  const activePresetId = useSettings((s) => s.activePresetId);
  const connected = useLive((l) => l.connected);
  const pedal = useLive((l) => l.pedal.connected);
  // 센서 모드는 연결된 손마다 앵커가 있어야 최초 설정 완료(PLAY-004 D9). 키보드 전용은 readiness가 면제한다
  const done = sensorKind === 'none' ? firstSetupDone : firstSetupDone && anchorsReady(connected, [anchors[0] !== null, anchors[1] !== null]);
  return readiness({ sensorKind, connected, pedal, firstSetupDone: done, activePresetId });
}
