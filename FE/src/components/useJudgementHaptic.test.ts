// 렌더 라이브러리가 없어 훅이 쓰는 attachJudgementHaptic을 가짜 세션으로 검증한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JudgementEvent } from '@/engine/RhythmSession';

const hapticWave = vi.fn();
const enter = vi.fn();
const leave = vi.fn();
vi.mock('@/app/sources', () => ({ inputManager: { hapticWave: (...a: unknown[]) => hapticWave(...a) } }));
vi.mock('@/app/hapticMode', () => ({ enterJudgementHaptic: () => enter(), leaveJudgementHaptic: () => leave() }));

import { attachJudgementHaptic } from './useJudgementHaptic';
import { HIT_WAVE } from '@/domain/haptics';

function fakeSession() {
  const ls = new Set<(e: JudgementEvent) => void>();
  return {
    onJudgement: (l: (e: JudgementEvent) => void) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    emit: (e: Partial<JudgementEvent>) => {
      for (const l of ls) l({ judgement: 'PERFECT', deltaMs: 0, pad: 'SNARE', noteIndex: 0, at: 0, stickId: 0, ...e } as JudgementEvent);
    },
    size: () => ls.size,
  };
}

beforeEach(() => {
  hapticWave.mockClear();
  enter.mockClear();
  leave.mockClear();
});

describe('attachJudgementHaptic', () => {
  it('붙이면 판정 모드에 진입하고, 해제하면 이탈·구독 해제한다', () => {
    const s = fakeSession();
    const off = attachJudgementHaptic(s);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(s.size()).toBe(1);
    off();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(s.size()).toBe(0);
  });

  it('PERFECT·GOOD는 그 손에만 파형을 보낸다', () => {
    const s = fakeSession();
    attachJudgementHaptic(s);
    s.emit({ judgement: 'PERFECT', stickId: 1 });
    s.emit({ judgement: 'GOOD', stickId: 0 });
    expect(hapticWave.mock.calls).toEqual([
      [1, HIT_WAVE.PERFECT],
      [0, HIT_WAVE.GOOD],
    ]);
  });

  it('MISS와 stickId가 null인 판정은 보내지 않는다', () => {
    const s = fakeSession();
    attachJudgementHaptic(s);
    s.emit({ judgement: 'MISS', stickId: null });
    s.emit({ judgement: 'MISS', stickId: 0 });
    s.emit({ judgement: 'PERFECT', stickId: null });
    expect(hapticWave).not.toHaveBeenCalled();
  });

  it('해제 뒤 판정에는 보내지 않는다', () => {
    const s = fakeSession();
    attachJudgementHaptic(s)();
    s.emit({ judgement: 'PERFECT', stickId: 0 });
    expect(hapticWave).not.toHaveBeenCalled();
  });
});
