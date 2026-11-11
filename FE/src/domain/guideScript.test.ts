import { describe, expect, it } from 'vitest';
import {
  buildGuideScript,
  CURSOR_END_POS,
  CURSOR_START_POS,
  EXAMPLE_STEPS,
  GAME_GUIDE_OPTIONS,
  HIT_WINDOW_MS,
  HOLD_MS,
  holdStartOf,
  MOVE_MS,
  stateAt,
  stepTarget,
} from './guideScript';

const script = buildGuideScript();
const progressAtBeat = (beat: number) => (beat - CURSOR_START_POS) / (CURSOR_END_POS - CURSOR_START_POS);
/** ② 구간 시작 시각 */
const runStart = script.segments.find((s) => s.kind === 'run')!.t0;
/** ②에서 칸 i 음표 시각 */
const hitTime = (i: number) => runStart + script.leadMs + (script.barMs * EXAMPLE_STEPS[i].beat) / 8;

describe('예시 상수', () => {
  it('8칸이고 beat가 0~7이다', () => {
    expect(EXAMPLE_STEPS.map((s) => s.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(EXAMPLE_STEPS[0].pads).toEqual(['CRASH', 'KICK']);
    expect(EXAMPLE_STEPS[2].pads).toEqual(['HIHAT', 'SNARE']);
    expect(EXAMPLE_STEPS[4].pads).toEqual(['HIHAT', 'KICK']);
    expect(EXAMPLE_STEPS[5].pads).toEqual(['HIHAT', 'KICK']);
  });
  it('칸 i의 멈춤 시작 시각은 (이동+멈춤) 간격이다', () => {
    EXAMPLE_STEPS.forEach((_, i) => expect(holdStartOf(script, i)).toBe(MOVE_MS + i * (MOVE_MS + HOLD_MS)));
  });
});

describe('stateAt ① 하나씩 보기', () => {
  it('처음에는 커서가 시작 위치에서 첫 음표로 이동 중이고 다음 칸은 0', () => {
    const s = stateAt(script, 0);
    expect(s.phase).toBe('step');
    expect(s.progress).toBeCloseTo(0, 5);
    expect(s.active).toBeNull();
    expect(s.next).toBe(0);
    expect(s.done.size).toBe(0);
  });
  it('이동 중간에는 시작과 첫 음표 사이에 있다', () => {
    const s = stateAt(script, MOVE_MS / 2);
    expect(s.progress).toBeGreaterThan(0);
    expect(s.progress).toBeLessThan(progressAtBeat(0));
    expect(s.active).toBeNull();
  });
  it('멈춤 구간에서는 그 칸이 active이고 커서가 음표 위에 있다', () => {
    const s = stateAt(script, holdStartOf(script, 2) + 10);
    expect(s.active).toBe(2);
    expect(s.next).toBeNull();
    expect(s.progress).toBeCloseTo(progressAtBeat(2), 5);
    expect([...s.done]).toEqual([0, 1]);
  });
  it('멈춤이 끝나면 그 칸이 done이고 다음 칸으로 이동 중이다', () => {
    const s = stateAt(script, holdStartOf(script, 2) + HOLD_MS + 10);
    expect(s.active).toBeNull();
    expect(s.next).toBe(3);
    expect([...s.done]).toEqual([0, 1, 2]);
  });
  it('마지막 음표 뒤 끝 멈춤에서는 모두 done, next 없음', () => {
    const last = holdStartOf(script, 7) + HOLD_MS + MOVE_MS + 10;
    const s = stateAt(script, last);
    expect(s.phase).toBe('step');
    expect(s.active).toBeNull();
    expect(s.next).toBeNull();
    expect(s.done.size).toBe(8);
    expect(s.progress).toBeCloseTo(1, 5);
  });
});

describe('stateAt ② 박에 맞춰 이어서', () => {
  it('되돌림 구간은 phase run, 커서는 처음, done 없음', () => {
    const resetStart = script.segments.find((s) => s.reset)!.t0;
    const s = stateAt(script, resetStart + 10);
    expect(s.phase).toBe('run');
    expect(s.progress).toBeCloseTo(0, 5);
    expect(s.done.size).toBe(0);
    expect(s.active).toBeNull();
  });
  it('타격 창 안에서만 active', () => {
    const s = stateAt(script, hitTime(3) + HIT_WINDOW_MS / 2);
    expect(s.phase).toBe('run');
    expect(s.active).toBe(3);
    expect([...s.done]).toEqual([0, 1, 2]);
    expect(s.progress).toBeCloseTo(progressAtBeat(3) + (HIT_WINDOW_MS / 2 / script.barMs) * 8 / (CURSOR_END_POS - CURSOR_START_POS), 4);
  });
  it('타격 창 직전은 active 없음, 직후는 done에 든다', () => {
    const before = stateAt(script, hitTime(3) - 100);
    expect(before.active).toBeNull();
    expect(before.next).toBe(3);
    expect(before.done.has(3)).toBe(false);
    const after = stateAt(script, hitTime(3) + HIT_WINDOW_MS + 1);
    expect(after.active).toBeNull();
    expect(after.done.has(3)).toBe(true);
  });
  it('끝 멈춤에서는 모두 done', () => {
    const s = stateAt(script, script.totalMs - 100);
    expect(s.phase).toBe('run');
    expect(s.done.size).toBe(8);
    expect(s.active).toBeNull();
    expect(s.next).toBeNull();
  });
});

describe('루프', () => {
  it('totalMs 뒤는 처음으로 돌아간다', () => {
    const a = stateAt(script, 100);
    const b = stateAt(script, script.totalMs + 100);
    expect(b).toEqual(a);
  });
  it('음수 시각도 루프 안으로 접는다', () => {
    expect(stateAt(script, -1).phase).toBe('run');
  });
});

describe('stepTarget (◀ ▶)', () => {
  const at = (t: number) => stateAt(script, t);
  it('멈춤 중에는 앞뒤 칸', () => {
    const s = at(holdStartOf(script, 3) + 1);
    expect(stepTarget(script, s, 1)).toBe(4);
    expect(stepTarget(script, s, -1)).toBe(2);
  });
  it('이동 중에는 곧 닿을 칸 기준', () => {
    const s = at(holdStartOf(script, 3) + HOLD_MS + 100); // 3 → 4로 이동 중, next 4
    expect(stepTarget(script, s, 1)).toBe(4);
    expect(stepTarget(script, s, -1)).toBe(3);
  });
  it('양 끝에서 넘어가지 않는다', () => {
    expect(stepTarget(script, at(holdStartOf(script, 0) + 1), -1)).toBe(0);
    expect(stepTarget(script, at(holdStartOf(script, 7) + 1), 1)).toBe(7);
  });
  it('②에서 ▶는 첫 칸, ◀는 마지막 칸', () => {
    const s = at(hitTime(2) + 10);
    expect(stepTarget(script, s, 1)).toBe(0);
    expect(stepTarget(script, s, -1)).toBe(7);
  });
});

describe('리듬 게임 시간표(GAME_GUIDE_OPTIONS)', () => {
  const game = buildGuideScript(undefined, undefined, GAME_GUIDE_OPTIONS);

  it('기본 시간표는 옵션이 없으면 그대로(악보 커서 범위)', () => {
    expect(script.startPos).toBeCloseTo(CURSOR_START_POS, 10);
    expect(script.endPos).toBeCloseTo(CURSOR_END_POS, 10);
  });

  it('시작은 노트가 판정선 위 4칸에서 내려오고 progress 0, 끝은 1이다', () => {
    expect(game.startPos).toBe(-4);
    expect(game.endPos).toBe(8);
    expect(stateAt(game, 0).progress).toBeCloseTo(0, 5);
    expect(stateAt(game, game.totalMs - 1).progress).toBeCloseTo(1, 5);
  });

  it('① 첫 칸은 더 길게(1400ms) 이동해 노트가 내려오는 것이 보인다', () => {
    expect(holdStartOf(game, 0)).toBe(GAME_GUIDE_OPTIONS.firstMoveMs);
    const s = stateAt(game, holdStartOf(game, 0) + 1);
    expect(s.active).toBe(0);
    // 칸 0이 판정선에 닿은 위치: (0 − (−4)) ÷ 12
    expect(s.progress).toBeCloseTo(4 / 12, 5);
  });

  it('② 노트가 4칸(8분) 앞에서 시작해 첫 음표까지 4칸 길이로 간다', () => {
    expect(game.leadMs).toBeCloseTo(game.barMs / 2, 5);
  });
});
