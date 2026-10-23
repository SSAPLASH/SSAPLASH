// 타격 이펙트 공용 훅. live 스토어의 hitSeq가 바뀔 때마다 hits ref에 패드별 마지막 타격을 기록한다.
// 세팅·자유 연주·캘리브레이션이 같은 KitCanvas hits로 연결해 이펙트가 같은 모양으로 보이게 한다.
import { useEffect } from 'react';
import { useLive } from '@/store/liveStore';
import type { HitFx, ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/pads';

/** 이펙트 한 건 기록. 훅 밖(캘리브레이션의 확인 타격 등)에서도 같은 모양으로 쓴다 */
export function markHit(hits: Map<PadId, HitFx>, pad: PadId, velocity: number, hand: 0 | 1 | null): void {
  hits.set(pad, { at: performance.now(), velocity, hand });
}

/**
 * @param hits KitCanvas에 넘기는 ref
 * @param accept 이펙트를 낼 타격만 거르는 조건(기본: 패드가 정해진 타격 전부)
 */
export function useHitFx(hits: React.RefObject<Map<PadId, HitFx>>, accept?: (hit: ResolvedHit) => boolean): void {
  useEffect(() => {
    // 자세(60Hz)와 분리하려고 store를 직접 구독한다
    return useLive.subscribe((s, prev) => {
      const hit = s.lastHit;
      if (s.hitSeq === prev.hitSeq || !hit || !hit.pad) return;
      if (accept && !accept(hit)) return;
      markHit(hits.current, hit.pad, hit.velocity, hit.stickId);
    });
  }, [hits, accept]);
}
