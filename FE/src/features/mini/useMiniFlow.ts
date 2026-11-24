// 미니게임 한 판의 단계 진행 훅 (설계 MODE-006-minigame-speed 3절 「흐름 훅」). 카운트다운·제한 시간·마무리 타이머를 걸고 단계 상태 기계(domain/miniFlow)를 돌린다.
// 다섯 게임이 같이 쓴다. 게임별 집계와 「시작!」·「끝!」 같은 표시는 게임 화면이 한다.
// 시작 시각은 `performance.now()` 축이라 타격의 시각(tHit·tRecv)과 바로 견줄 수 있다. 탭이 가려져 타이머가 늦게 불려도 집계는 시각으로 가리므로 어긋나지 않는다.
import { useCallback, useEffect, useReducer } from 'react';
import { COUNTDOWN_FROM, COUNTDOWN_MS, COUNTDOWN_STEP_MS, nextPhase, type MiniFlowEvent, type MiniPhase } from '@/features/mini/domain/miniFlow';

export interface MiniFlowOptions {
  /** 제한 시간(ms). 넘기지 않으면 타이머를 걸지 않고 화면이 `finish`를 부를 때까지 `playing`에 머문다 */
  playMs?: number;
  /** 마무리 시간(ms). `closing`에 머무는 길이 */
  closingMs: number;
}

export interface MiniFlow {
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  /** `playing`으로 넘어온 순간의 `performance.now()`. 그 전에는 null이고 마무리·결과 단계에서는 그 판의 값이 남는다 */
  startedAt: number | null;
  /** `intro` → `countdown` */
  start: () => void;
  /** `playing` → `closing`. 다른 단계에서 부르면 아무 일도 없다 */
  finish: () => void;
  /** `result` → `countdown` */
  retry: () => void;
  /** 어느 단계에서든 `intro`. 그 판을 버린다 */
  quit: () => void;
}

interface State {
  phase: MiniPhase;
  countdown: number | null;
  startedAt: number | null;
}

type Action =
  | { type: Exclude<MiniFlowEvent, 'countdownEnd'> }
  // 플레이가 시작된 시각은 타이머가 불린 순간에 재서 넘긴다(리듀서는 시계를 읽지 않는다)
  | { type: 'countdownEnd'; now: number }
  | { type: 'tick'; value: number };

const INITIAL: State = { phase: 'intro', countdown: null, startedAt: null };

function reduce(state: State, action: Action): State {
  if (action.type === 'tick') return state.phase === 'countdown' ? { ...state, countdown: action.value } : state;
  const phase = nextPhase(state.phase, action.type);
  if (phase === state.phase) return state;
  switch (phase) {
    case 'intro':
      return INITIAL;
    case 'countdown':
      return { phase, countdown: COUNTDOWN_FROM, startedAt: null };
    case 'playing':
      return { phase, countdown: null, startedAt: action.type === 'countdownEnd' ? action.now : null };
    default:
      // closing·result: 그 판의 시작 시각을 남겨 둔다(늦게 도착한 타격을 가릴 때 쓴다)
      return { ...state, phase };
  }
}

export function useMiniFlow({ playMs, closingMs }: MiniFlowOptions): MiniFlow {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const { phase, startedAt } = state;

  useEffect(() => {
    if (phase === 'countdown') {
      // 숫자 바꾸기와 끝을 따로 걸어 숫자마다 생기는 지연이 쌓이지 않게 한다
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (let step = 1; step < COUNTDOWN_FROM; step += 1) {
        timers.push(setTimeout(() => dispatch({ type: 'tick', value: COUNTDOWN_FROM - step }), COUNTDOWN_STEP_MS * step));
      }
      timers.push(setTimeout(() => dispatch({ type: 'countdownEnd', now: performance.now() }), COUNTDOWN_MS));
      return () => timers.forEach(clearTimeout);
    }
    if (phase === 'playing') {
      if (playMs === undefined || startedAt === null) return;
      // 남은 시간은 시작 시각에서 다시 계산한다(효과가 다시 걸려도 끝나는 때가 밀리지 않는다)
      const left = Math.max(0, playMs - (performance.now() - startedAt));
      const timer = setTimeout(() => dispatch({ type: 'finish' }), left);
      return () => clearTimeout(timer);
    }
    if (phase === 'closing') {
      const timer = setTimeout(() => dispatch({ type: 'closingEnd' }), closingMs);
      return () => clearTimeout(timer);
    }
  }, [phase, startedAt, playMs, closingMs]);

  const start = useCallback(() => dispatch({ type: 'start' }), []);
  const finish = useCallback(() => dispatch({ type: 'finish' }), []);
  const retry = useCallback(() => dispatch({ type: 'retry' }), []);
  const quit = useCallback(() => dispatch({ type: 'quit' }), []);

  return { phase: state.phase, countdown: state.countdown, startedAt: state.startedAt, start, finish, retry, quit };
}
