// 일시정지 자동 트리거 공용 훅 (MODE-003 설계 4-3·D9). 악보 연주·리듬 게임이 함께 쓴다.
// 연결 끊김(어느 한 손·한 발이라도 연결→끊김, 센서 모드만)·메뉴 요청(liveStore.pauseRequested) → pauseTo 호출.
// 한 손만 빠져도 연주가 안 되므로 멈춘다(SETUP-001 설계 D1). 끊김은 동글 LINK로 최대 약 2초 늦게 온다.
// 스토어 구독이라 effect 안에서 setState하지 않는다.
import { useEffect } from 'react';
import { useLive } from '@/store/liveStore';
import { useSettings } from '@/store/settingsStore';

/** 어느 한 손이라도 연결 → 끊김이 됐는지 */
export function handDropped(prev: readonly [boolean, boolean], now: readonly [boolean, boolean]): boolean {
  return (prev[0] && !now[0]) || (prev[1] && !now[1]);
}

/** 어느 한 발이라도 연결 → 끊김이 됐는지(handDropped와 같은 식) */
export function pedalDropped(prev: readonly [boolean, boolean], now: readonly [boolean, boolean]): boolean {
  return (prev[0] && !now[0]) || (prev[1] && !now[1]);
}

export function usePauseTriggers(pauseTo: (reason: 'disconnected' | 'menu') => void): void {
  useEffect(() => {
    return useLive.subscribe((s, prev) => {
      const dropped = handDropped(prev.connected, s.connected) || pedalDropped(prev.pedal.connected, s.pedal.connected);
      if (dropped && useSettings.getState().sensorKind !== 'none') pauseTo('disconnected');
      if (s.pauseRequested === 'menu') {
        pauseTo('menu');
        useLive.setState({ pauseRequested: null });
      }
    });
  }, [pauseTo]);
}
