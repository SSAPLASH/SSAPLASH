// 보정 팝업 첫 안내(CaptureNotice)가 떠 있는지 정한다(PLAY-004 후속). 팝업이 열리면 뜨고, 첫 타격이 수락되고 NOTICE_MIN_MS가 지나면 닫힌다.
// 한 번 닫히면 그 팝업에서는 다시 열리지 않는다([◯◯ 다시]로 되돌아가도). 실수 안내(hint/)는 이 값이 true인 동안 뜨지 않는다.
import { useEffect, useState } from 'react';
import type { CaptureSnapshot } from '@/engine/HitCapture';
import { useLive } from '@/store/liveStore';

/** 스틱을 집다 생긴 타격으로 읽기 전에 사라지지 않게 최소한 이만큼(ms)은 보인다 */
export const NOTICE_MIN_MS = 3000;

/** 이 보정에서 수락된 타격이 하나라도 있는가 */
function hasAccepted(cap: CaptureSnapshot | null): boolean {
  if (!cap) return false;
  return cap.lastAccepted !== null || cap.counts[0] + cap.counts[1] > 0 || Object.keys(cap.captured).length > 0;
}

/** enabled가 false면(팝업 밖) 항상 false */
export function useCaptureNotice(enabled: boolean): boolean {
  const [hit, setHit] = useState(() => hasAccepted(useLive.getState().calibration.capture));
  const [minPassed, setMinPassed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => setMinPassed(true), NOTICE_MIN_MS);
    const off = useLive.subscribe((l) => {
      if (hasAccepted(l.calibration.capture)) setHit(true);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [enabled]);

  return enabled && !(hit && minPassed);
}
