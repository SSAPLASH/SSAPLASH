// 일시정지 자동 트리거 공용 훅 (MODE-003 설계 4-3·D9). 악보 연주·리듬 게임이 함께 쓴다.
// 연결 끊김(둘 다 false로 전이, 센서 모드만)·메뉴 요청(liveStore.pauseRequested) → pauseTo 호출.
// 스토어 구독이라 effect 안에서 setState하지 않는다.
import { useEffect } from 'react';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

export function usePauseTriggers(pauseTo: (reason: 'disconnected' | 'menu') => void): void {
  useEffect(() => {
    return useLive.subscribe((s, prev) => {
      const was = prev.connected[0] || prev.connected[1];
      const now = s.connected[0] || s.connected[1];
      if (was && !now && useSettings.getState().sensorKind !== 'none') pauseTo('disconnected');
      if (s.pauseRequested === 'menu') {
        pauseTo('menu');
        useLive.setState({ pauseRequested: null });
      }
    });
  }, [pauseTo]);
}
