// 이펙트 이벤트 소스 — liveStore 구독, 그리고 랩·미리보기가 쓰는 자체 emitter.
import { visualPadOf } from '@/domain/kit/drumKit';
import type { ResolvedHit } from '@/domain/events';
import type { FxEvent, FxMode, FxSource } from '@/domain/hitFx/types';
import type { JudgementEvent } from '@/engine/RhythmSession';
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

/**
 * 게임·악보 타격 하나를 이펙트 이벤트로 바꾼다(설계 4-1). `ev`는 같은 호출에서 `handleHit`이 돌려준 판정.
 * - 판정 중(active)이고 판정 있음 → PERFECT/GOOD(deltaMs·noteIndex 포함)
 * - 판정 중인데 맞는 노트가 없음 → 헛침(stray, 판정 null)
 * - 판정 중이 아님(일시정지·종료 등) → 판정 null (자유 연주와 같은 이펙트)
 * 패드가 없는 타격은 null. 이펙트는 표시만 한다 — 판정·점수에는 아무것도 하지 않는다.
 */
export function judgedFxEvent(hit: Pick<ResolvedHit, 'id' | 'pad' | 'velocity'>, ev: JudgementEvent | null, mode: 'game' | 'sheet', active: boolean): FxEvent | null {
  if (!hit.pad) return null;
  const pad = visualPadOf(hit.pad);
  if (!pad) return null;
  const base = { seq: hit.id, pad, velocity: hit.velocity, mode, combo: null };
  if (active && ev) return { ...base, judgement: ev.judgement, deltaMs: ev.deltaMs, noteIndex: ev.noteIndex, stray: false };
  if (active) return { ...base, judgement: null, deltaMs: null, noteIndex: null, stray: true };
  return { ...base, judgement: null, deltaMs: null, noteIndex: null, stray: false };
}

/**
 * 놓친 노트(MISS) 이펙트 이벤트. 타격이 없으므로 세기 0(패드 흔들림 없음)이고 패드 emitter에는 보내지 않는다.
 * seq는 음수로 둬 타격 id와 겹치지 않는다. MISS가 아닌 판정은 null(그 이펙트는 onHit 경로에서 낸다 — 두 번 내지 않게)
 */
export function missFxEvent(e: JudgementEvent, mode: 'game' | 'sheet'): FxEvent | null {
  if (e.judgement !== 'MISS') return null;
  return { seq: -(e.noteIndex + 1), pad: visualPadOf(e.pad) ?? e.pad, velocity: 0, mode, judgement: 'MISS', deltaMs: null, combo: null, noteIndex: e.noteIndex, stray: false };
}
