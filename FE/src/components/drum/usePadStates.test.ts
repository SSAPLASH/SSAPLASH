import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPadStateMachine } from './padStateMachine';
import { HIT_MS, JUDGE_MS, visualPadOf, type PadVisualState } from '@/domain/kit/drumKit';
import type { PadId } from '@/domain/kit/pads';

// 훅의 타이머·상태 규칙은 순수 모듈 padStateMachine에 있으므로 fake timers로 검증한다
function setup() {
  const states: Partial<Record<PadId, PadVisualState>> = {};
  const machine = createPadStateMachine({
    hitMs: HIT_MS,
    judgeMs: JUDGE_MS,
    onChange: (pad, next) => {
      if (next === undefined) delete states[pad];
      else states[pad] = next;
    },
  });
  return { states, machine };
}

describe('padStateMachine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hit은 HIT_MS 동안 점등하고 만료되면 idle(키 제거)', () => {
    const { states, machine } = setup();
    machine.hit('SNARE');
    expect(states.SNARE).toBe('hit');
    vi.advanceTimersByTime(HIT_MS - 1);
    expect(states.SNARE).toBe('hit');
    vi.advanceTimersByTime(1);
    expect('SNARE' in states).toBe(false);
  });

  it('판정은 JUDGE_MS 동안 표시하고 만료되면 idle', () => {
    const { states, machine } = setup();
    machine.judge('KICK', 'PERFECT');
    expect(states.KICK).toBe('perfect');
    vi.advanceTimersByTime(JUDGE_MS - 1);
    expect(states.KICK).toBe('perfect');
    vi.advanceTimersByTime(1);
    expect('KICK' in states).toBe(false);
  });

  it('판정 종류별 상태: PERFECT·GOOD·MISS', () => {
    const { states, machine } = setup();
    machine.judge('CRASH', 'PERFECT');
    machine.judge('RIDE', 'GOOD');
    machine.judge('MID_TOM', 'MISS');
    expect(states.CRASH).toBe('perfect');
    expect(states.RIDE).toBe('good');
    expect(states.MID_TOM).toBe('miss');
  });

  it('판정 중 들어온 hit은 무시하고 판정 타이머를 유지한다', () => {
    const { states, machine } = setup();
    machine.judge('SNARE', 'GOOD');
    vi.advanceTimersByTime(100);
    machine.hit('SNARE');
    expect(states.SNARE).toBe('good');
    // 판정 시작 기준 JUDGE_MS에 만료(hit이 타이머를 바꾸지 않았다)
    vi.advanceTimersByTime(JUDGE_MS - 100);
    expect('SNARE' in states).toBe(false);
  });

  it('hit 중 판정이 오면 판정이 우선하고 JUDGE_MS를 새로 센다', () => {
    const { states, machine } = setup();
    machine.hit('SNARE');
    vi.advanceTimersByTime(100);
    machine.judge('SNARE', 'MISS');
    expect(states.SNARE).toBe('miss');
    vi.advanceTimersByTime(HIT_MS); // 이전 hit 타이머가 남았다면 여기서 꺼질 것
    expect(states.SNARE).toBe('miss');
    vi.advanceTimersByTime(JUDGE_MS - HIT_MS);
    expect('SNARE' in states).toBe(false);
  });

  it('새 hit은 이전 타이머를 대체한다(연타 시 마지막 hit 기준으로 만료)', () => {
    const { states, machine } = setup();
    machine.hit('HIHAT');
    vi.advanceTimersByTime(HIT_MS - 20);
    machine.hit('HIHAT');
    vi.advanceTimersByTime(HIT_MS - 1);
    expect(states.HIHAT).toBe('hit');
    vi.advanceTimersByTime(1);
    expect('HIHAT' in states).toBe(false);
  });

  it('패드마다 독립적으로 동작한다', () => {
    const { states, machine } = setup();
    machine.hit('SNARE');
    vi.advanceTimersByTime(100);
    machine.judge('KICK', 'PERFECT');
    vi.advanceTimersByTime(HIT_MS - 100);
    expect('SNARE' in states).toBe(false);
    expect(states.KICK).toBe('perfect');
  });

  it('dispose는 타이머를 모두 해제해 이후 onChange가 오지 않는다', () => {
    const onChange = vi.fn();
    const machine = createPadStateMachine({ hitMs: HIT_MS, judgeMs: JUDGE_MS, onChange });
    machine.hit('SNARE');
    machine.judge('KICK', 'GOOD');
    onChange.mockClear();
    machine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(JUDGE_MS * 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dispose 뒤에는 판정 우선 기록도 지워진다', () => {
    const { states, machine } = setup();
    machine.judge('SNARE', 'GOOD');
    machine.dispose();
    machine.hit('SNARE');
    expect(states.SNARE).toBe('hit');
  });

  it('주입한 setTimeout·clearTimeout을 쓴다', () => {
    const set = vi.fn(() => 7 as unknown as ReturnType<typeof setTimeout>);
    const clear = vi.fn();
    const machine = createPadStateMachine({
      hitMs: HIT_MS,
      judgeMs: JUDGE_MS,
      onChange: () => {},
      setTimeout: set,
      clearTimeout: clear,
    });
    machine.hit('SNARE');
    expect(set).toHaveBeenCalledWith(expect.any(Function), HIT_MS);
    machine.hit('SNARE');
    expect(clear).toHaveBeenCalledWith(7);
  });

  it('HIHAT_PEDAL은 visualPadOf로 HIHAT에 점등된다', () => {
    const { states, machine } = setup();
    const pad = visualPadOf('HIHAT_PEDAL');
    expect(pad).toBe('HIHAT');
    machine.hit(pad as PadId);
    expect(states.HIHAT).toBe('hit');
    expect('HIHAT_PEDAL' in states).toBe(false);
  });
});
