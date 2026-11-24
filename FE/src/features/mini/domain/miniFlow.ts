// 미니게임 한 판의 단계 상태 기계 (설계 MODE-006-minigame-speed 3절 「단계」). 순수 함수만 둔다 — 타이머는 useMiniFlow가 건다.
// 다섯 게임이 같이 쓴다.

/** 시작 전 안내 → 카운트다운 → 플레이 → 마무리(늦게 도착한 타격을 받거나 마지막 표시를 보이는 시간) → 결과 */
export type MiniPhase = 'intro' | 'countdown' | 'playing' | 'closing' | 'result';

/**
 * 단계를 움직이는 일.
 * start [시작하기] · countdownEnd 카운트다운이 끝남 · finish 플레이가 끝남(제한 시간이 지났거나 화면이 알림) ·
 * closingEnd 마무리 시간이 지남 · retry [다시 하기] · quit [그만하기]
 */
export type MiniFlowEvent = 'start' | 'countdownEnd' | 'finish' | 'closingEnd' | 'retry' | 'quit';

/** 카운트다운 숫자 하나의 길이. 곡이 없어 박자에 맞출 것이 없으므로 1초씩 보인다(D17) */
export const COUNTDOWN_STEP_MS = 1000;
/** 카운트다운이 시작하는 숫자(3·2·1) */
export const COUNTDOWN_FROM = 3;
/** 카운트다운 전체 길이 */
export const COUNTDOWN_MS = COUNTDOWN_STEP_MS * COUNTDOWN_FROM;

/** 다음 단계. 그 단계에서 일어날 수 없는 일이면 단계를 그대로 돌려준다. [그만하기]는 어느 단계에서든 안내로 돌린다 */
export function nextPhase(phase: MiniPhase, event: MiniFlowEvent): MiniPhase {
  if (event === 'quit') return 'intro';
  switch (phase) {
    case 'intro':
      return event === 'start' ? 'countdown' : phase;
    case 'countdown':
      return event === 'countdownEnd' ? 'playing' : phase;
    case 'playing':
      return event === 'finish' ? 'closing' : phase;
    case 'closing':
      return event === 'closingEnd' ? 'result' : phase;
    default:
      return event === 'retry' ? 'countdown' : phase;
  }
}
