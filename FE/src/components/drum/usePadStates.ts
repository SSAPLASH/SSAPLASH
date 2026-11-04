import { useEffect, useState } from 'react';
import { useLive } from '@/store/liveStore';
import type { RhythmSession } from '@/engine/RhythmSession';
import type { PadId } from '@/domain/pads';
import { HIT_MS, JUDGE_MS, visualPadOf, type PadVisualState } from '@/domain/drumKit';
import { createPadStateMachine } from './padStateMachine';

type States = Partial<Record<PadId, PadVisualState>>;

/**
 * 패드별 표시 상태(hit → 판정 → idle).
 * - liveStore 타격(hitSeq)마다 해당 패드를 hit으로 HIT_MS 동안 점등
 * - session 판정 이벤트마다 perfect/good/miss를 JUDGE_MS 동안 표시(hit보다 우선, 판정 중 들어온 hit은 무시)
 * 타이머 규칙은 padStateMachine이 맡고, 이 훅은 구독과 상태 반영만 한다.
 * 바뀐 패드의 값만 갱신하고, 같은 값이면 이전 객체 참조를 유지한다(idle 패드는 키 없음).
 */
export function usePadStates(session?: RhythmSession | null): States {
  const [states, setStates] = useState<States>({});

  useEffect(() => {
    const machine = createPadStateMachine({
      hitMs: HIT_MS,
      judgeMs: JUDGE_MS,
      onChange: (pad, next) => {
        setStates((prev) => {
          if (next === undefined) {
            if (prev[pad] === undefined) return prev;
            const rest = { ...prev };
            delete rest[pad];
            return rest;
          }
          return prev[pad] === next ? prev : { ...prev, [pad]: next };
        });
      },
    });

    // hitSeq가 바뀔 때만 반응한다
    let lastSeq = useLive.getState().hitSeq;
    const unsubLive = useLive.subscribe((s) => {
      if (s.hitSeq === lastSeq) return;
      lastSeq = s.hitSeq;
      const hit = s.lastHit;
      if (!hit || !hit.pad) return;
      const pad = visualPadOf(hit.pad);
      if (!pad) return;
      machine.hit(pad);
    });

    const unsubJudge = session
      ? session.onJudgement((e) => {
          const pad = visualPadOf(e.pad);
          if (!pad) return;
          machine.judge(pad, e.judgement);
        })
      : undefined;

    return () => {
      unsubLive();
      unsubJudge?.();
      machine.dispose();
      setStates({});
    };
  }, [session]);

  return states;
}

/**
 * 패드별 타격 횟수 카운터. liveStore 타격(hitSeq)마다 `visualPadOf(hit.pad)` 패드의 값을 1 올린다.
 * DrumKit의 hitSeq로 넘기면 연타마다 타격 모션(CSS 애니메이션)이 다시 시작된다.
 */
export function usePadHitSeq(): Partial<Record<PadId, number>> {
  const [seq, setSeq] = useState<Partial<Record<PadId, number>>>({});

  useEffect(() => {
    let lastSeq = useLive.getState().hitSeq;
    const unsub = useLive.subscribe((s) => {
      if (s.hitSeq === lastSeq) return;
      lastSeq = s.hitSeq;
      const hit = s.lastHit;
      if (!hit || !hit.pad) return;
      const pad = visualPadOf(hit.pad);
      if (!pad) return;
      setSeq((prev) => ({ ...prev, [pad]: (prev[pad] ?? 0) + 1 }));
    });
    return () => {
      unsub();
      setSeq({});
    };
  }, []);

  return seq;
}
