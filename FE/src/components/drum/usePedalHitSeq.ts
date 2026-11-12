import { useEffect, useState } from 'react';
import { useLive } from '@/store/liveStore';

/**
 * 하이햇 페달 타격 횟수. liveStore 타격 중 pad가 HIHAT_PEDAL일 때마다 1 올린다.
 * usePadHitSeq는 페달 타격을 HIHAT 패드로 옮겨 세므로, 하이햇 닫힘 "칙" 모션용으로 따로 센다.
 */
export function usePedalHitSeq(): number {
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let lastSeq = useLive.getState().hitSeq;
    const unsub = useLive.subscribe((s) => {
      if (s.hitSeq === lastSeq) return;
      lastSeq = s.hitSeq;
      if (s.lastHit?.pad !== 'HIHAT_PEDAL') return;
      setSeq((n) => n + 1);
    });
    return () => {
      unsub();
      setSeq(0);
    };
  }, []);

  return seq;
}
