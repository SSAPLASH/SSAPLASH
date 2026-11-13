// liveStore의 타격(hitSeq)을 구독해 최근 n건을 새 것이 앞에 오도록 돌려준다. 세팅 타격 확인(HitLog)이 쓰고,
// 자유 연습 정보 띠도 같은 훅을 쓸 수 있다.
import { useEffect, useState } from 'react';
import { useLive } from '@/store/liveStore';
import type { PadId } from '@/domain/kit/pads';
import { isSensorSource } from '@/domain/events';

export interface RecentHit {
  /** 타격 id(미리보기는 음수). 목록 key로 쓴다 */
  id: number;
  pad: PadId | null;
  /** 0 왼손, 1 오른손. 키보드·톡 치기는 손을 알 수 없어 null */
  hand: 0 | 1 | null;
  velocity: number;
  /** 받은 시각(Date.now, 표시용) */
  at: number;
}

export function useRecentHits(n: number): RecentHit[] {
  const [hits, setHits] = useState<RecentHit[]>([]);

  useEffect(() => {
    // hitSeq가 바뀔 때만 반응한다(자세 60Hz 갱신은 무시)
    return useLive.subscribe((s, prev) => {
      const hit = s.lastHit;
      if (s.hitSeq === prev.hitSeq || !hit) return;
      const known = isSensorSource(hit.source);
      const next: RecentHit = { id: hit.id, pad: hit.pad, hand: known ? hit.stickId : null, velocity: hit.velocity, at: Date.now() };
      setHits((list) => [next, ...list].slice(0, n));
    });
  }, [n]);

  return hits;
}
