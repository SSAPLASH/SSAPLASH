import { describe, expect, it } from 'vitest';
import { COUNTDOWN_FROM, COUNTDOWN_MS, COUNTDOWN_STEP_MS, nextPhase, type MiniFlowEvent, type MiniPhase } from './miniFlow';

const PHASES: MiniPhase[] = ['intro', 'countdown', 'playing', 'closing', 'result'];
const EVENTS: MiniFlowEvent[] = ['start', 'countdownEnd', 'finish', 'closingEnd', 'retry', 'quit'];

/** 그 단계에서 의미 있는 일(quit 제외)과 다음 단계 */
const FORWARD: Record<MiniPhase, [MiniFlowEvent, MiniPhase]> = {
  intro: ['start', 'countdown'],
  countdown: ['countdownEnd', 'playing'],
  playing: ['finish', 'closing'],
  closing: ['closingEnd', 'result'],
  result: ['retry', 'countdown'],
};

describe('nextPhase', () => {
  it('정상 길: intro → countdown → playing → closing → result → (다시 하기) countdown', () => {
    let phase: MiniPhase = 'intro';
    for (const event of ['start', 'countdownEnd', 'finish', 'closingEnd'] as const) {
      phase = nextPhase(phase, event);
    }
    expect(phase).toBe('result');
    expect(nextPhase(phase, 'retry')).toBe('countdown');
  });

  it.each(PHASES)('%s에서 quit은 intro로 돌린다', (phase) => {
    expect(nextPhase(phase, 'quit')).toBe('intro');
  });

  it.each(PHASES)('%s에서 일어날 수 있는 일만 단계를 바꾸고 나머지는 그대로 둔다', (phase) => {
    const [valid, next] = FORWARD[phase];
    for (const event of EVENTS) {
      if (event === 'quit') continue;
      expect(nextPhase(phase, event)).toBe(event === valid ? next : phase);
    }
  });
});

describe('카운트다운 상수', () => {
  it('COUNTDOWN_MS는 한 숫자의 길이 × 시작 숫자', () => {
    expect(COUNTDOWN_MS).toBe(COUNTDOWN_STEP_MS * COUNTDOWN_FROM);
    expect(COUNTDOWN_MS).toBe(3000);
  });
});
