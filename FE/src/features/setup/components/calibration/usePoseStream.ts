// 세팅 화면의 자세 스트림(POSE 패킷) 켜기·끄기(PLAY-004).
// 스틱은 재부팅하면 모드가 초기화되므로, 연결된 손 수가 바뀔 때마다 다시 보낸다.
import { useEffect } from 'react';
import { inputManager } from '@/runtime/sources';

/**
 * enabled가 true인 동안 자세 스트림을 켠다. false가 되거나 언마운트하면 끈다.
 * connectedKey는 연결 상태가 바뀔 때 재전송하기 위한 값(연결된 손 수 등)이다.
 */
export function usePoseStream(enabled: boolean, connectedKey: number = 0): void {
  useEffect(() => {
    if (!enabled) return;
    inputManager.setPoseStream(true);
    return () => inputManager.setPoseStream(false);
  }, [enabled, connectedKey]);
}
