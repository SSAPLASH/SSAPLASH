// 이펙트 이벤트 소스 — liveStore 구독, 그리고 랩·미리보기가 쓰는 자체 emitter.
import { visualPadOf } from '@/domain/drumKit';
import type { FxEvent, FxMode, FxSource } from '@/domain/hitFx/types';
import { useLive } from '@/store/liveStore';

/**
 * 실제 연주 소스. hitSeq가 바뀔 때마다 이벤트를 낸다(React state를 거치지 않는다).
 * 하이햇 페달은 하이햇 패드로 옮기고, 패드가 없는 타격은 무시한다(usePadHitPulse와 같은 규칙).
 */
export function createLiveFxSource(mode: FxMode): FxSource {
  return (onEvent) => {
    let lastSeq = useLive.getState().hitSeq;
    return useLive.subscribe((s) => {
      if (s.hitSeq === lastSeq) return;
      lastSeq = s.hitSeq;
      const hit = s.lastHit;
      if (!hit || !hit.pad) return;
      const pad = visualPadOf(hit.pad);
      if (!pad) return;
      onEvent({ seq: s.hitSeq, pad, velocity: hit.velocity, mode, judgement: null, deltaMs: null, combo: null });
    });
  };
}

export interface FxEmitter {
  /** DrumKit의 fxSource·FxCanvas의 source로 넘긴다 */
  source: FxSource;
  /** 구독 중인 모든 캔버스에 같은 이벤트를 보낸다 */
  emit: (event: FxEvent) => void;
}

/** 랩·미리보기용 자체 emitter. 실제 타격(liveStore)과 섞이지 않는다 */
export function createFxEmitter(): FxEmitter {
  const listeners = new Set<(e: FxEvent) => void>();
  return {
    source: (onEvent) => {
      listeners.add(onEvent);
      return () => {
        listeners.delete(onEvent);
      };
    },
    emit: (event) => {
      for (const l of [...listeners]) l(event);
    },
  };
}
