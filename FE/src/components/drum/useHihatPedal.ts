import { useLive } from '@/store/liveStore';

/**
 * 하이햇 열림·닫힘 표시 상태(소리와 같은 규칙: 왼발 페달이 연결되어 있고 밟지 않았을 때만 열림).
 * 원시값 selector 두 개라 관계없는 liveStore 갱신에는 다시 그리지 않는다.
 */
export function useHihatPedal(): { closed: boolean; pedalOff: boolean } {
  const connected = useLive((s) => s.pedal.connected[0]);
  const pressed = useLive((s) => s.pedal.hihatClosed);
  const pedalOff = !connected;
  return { closed: pedalOff || pressed, pedalOff };
}
