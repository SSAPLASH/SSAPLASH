// 패드 표시 상태 타이머 규칙(순수 모듈). 리액트·liveStore·세션을 모른다.
// hit → HIT_MS 후 idle, 판정 → JUDGE_MS 후 idle, 판정 중 들어온 hit은 무시, 새 점등은 이전 타이머를 대체한다.
import type { PadId } from '@/domain/kit/pads';
import type { PadVisualState } from '@/domain/kit/drumKit';
import type { Judgement } from '@/domain/play/judgement';

type Kind = 'hit' | 'judge';

export interface PadStateMachineOptions {
  /** 패드 상태가 바뀔 때 호출. next가 undefined면 idle(키 제거) */
  onChange: (pad: PadId, next: PadVisualState | undefined) => void;
  hitMs: number;
  judgeMs: number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface PadStateMachine {
  hit: (pad: PadId) => void;
  judge: (pad: PadId, judgement: Judgement) => void;
  /** 모든 타이머를 정리하고 점등 중이던 패드를 idle로 되돌린다 */
  dispose: () => void;
}

export function createPadStateMachine(opts: PadStateMachineOptions): PadStateMachine {
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((id) => clearTimeout(id));
  const timers: Partial<Record<PadId, ReturnType<typeof setTimeout>>> = {};
  const kinds: Partial<Record<PadId, Kind>> = {};

  const light = (pad: PadId, next: PadVisualState, ms: number, kind: Kind) => {
    const old = timers[pad];
    if (old !== undefined) clearT(old);
    kinds[pad] = kind;
    opts.onChange(pad, next);
    timers[pad] = setT(() => {
      delete timers[pad];
      delete kinds[pad];
      opts.onChange(pad, undefined);
    }, ms);
  };

  return {
    hit(pad) {
      if (kinds[pad] === 'judge') return;
      light(pad, 'hit', opts.hitMs, 'hit');
    },
    judge(pad, judgement) {
      const next: PadVisualState = judgement === 'PERFECT' ? 'perfect' : judgement === 'GOOD' ? 'good' : 'miss';
      light(pad, next, opts.judgeMs, 'judge');
    },
    dispose() {
      for (const key of Object.keys(timers) as PadId[]) {
        const t = timers[key];
        if (t !== undefined) clearT(t);
        delete timers[key];
        delete kinds[key];
      }
    },
  };
}
