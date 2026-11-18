// 렌더 라이브러리가 없어 훅이 쓰는 attachJudgementHaptic을 가짜 세션으로 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JudgementEvent } from '@/engine/RhythmSession';

const hapticWave = vi.fn();
const enter = vi.fn();
const leave = vi.fn();
vi.mock('@/runtime/sources', () => ({ inputManager: { hapticWave: (...a: unknown[]) => hapticWave(...a) } }));
vi.mock('@/features/play/hapticMode', async (orig) => ({
  effectivePlayHaptic: (await orig<typeof import('@/features/play/hapticMode')>()).effectivePlayHaptic,
  enterJudgementHaptic: () => enter(),
  leaveJudgementHaptic: () => leave(),
}));

import { attachJudgementHaptic } from './useJudgementHaptic';
import { HIT_WAVE } from '@/features/play/domain/haptics';
import { useSettings } from '@/store/settingsStore';

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
  useSettings.setState({ playHaptic: 'judgement' });
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

describe('playHaptic 설정(PLAY-006 방식 비교)', () => {
  beforeEach(() => vi.stubEnv('VITE_MONITOR', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  it("모니터 빌드가 아니면 저장값이 'local'이어도 판정 모드에 들어가고 파형을 보낸다", () => {
    vi.stubEnv('VITE_MONITOR', 'false');
    useSettings.setState({ playHaptic: 'local' });
    const s = fakeSession();
    attachJudgementHaptic(s);
    expect(enter).toHaveBeenCalledTimes(1);
    s.emit({ judgement: 'PERFECT', stickId: 0 });
    expect(hapticWave).toHaveBeenCalledWith(0, HIT_WAVE.PERFECT);
  });

  it("'local'이면 판정 모드에 들어가지 않고 파형도 보내지 않는다", () => {
    useSettings.setState({ playHaptic: 'local' });
    const s = fakeSession();
    const off = attachJudgementHaptic(s);
    expect(enter).not.toHaveBeenCalled();
    expect(s.size()).toBe(0);
    s.emit({ judgement: 'PERFECT', stickId: 0 });
    expect(hapticWave).not.toHaveBeenCalled();
    off();
    expect(leave).not.toHaveBeenCalled();
  });

  it("'judgement'면 지금과 같다(진입·파형·이탈)", () => {
    const s = fakeSession();
    const off = attachJudgementHaptic(s);
    expect(enter).toHaveBeenCalledTimes(1);
    s.emit({ judgement: 'GOOD', stickId: 1 });
    expect(hapticWave).toHaveBeenCalledWith(1, HIT_WAVE.GOOD);
    off();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('값은 붙일 때 한 번 읽어 그 판 동안 고정한다(판 도중 바꿔도 그대로)', () => {
    const s = fakeSession();
    const off = attachJudgementHaptic(s);
    useSettings.setState({ playHaptic: 'local' });
    s.emit({ judgement: 'PERFECT', stickId: 0 });
    expect(hapticWave).toHaveBeenCalledTimes(1);
    off();
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
