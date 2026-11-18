import { beforeEach, describe, expect, it, vi } from 'vitest';

const setLocalHaptic = vi.fn();
vi.mock('@/runtime/sources', () => ({ inputManager: { setLocalHaptic: (...a: unknown[]) => setLocalHaptic(...a) } }));

import {
  currentHapticMode,
  enterJudgementHaptic,
  leaveJudgementHaptic,
  onStickLinked,
  pageHideForTest,
  resetHapticModeForTest,
} from './hapticMode';

beforeEach(() => {
  resetHapticModeForTest();
  setLocalHaptic.mockClear();
});

describe('hapticMode', () => {
  it('진입하면 judgement로 바뀌며 전체에 0을 보내고, 이탈하면 local로 1을 보낸다', () => {
    enterJudgementHaptic();
    expect(currentHapticMode()).toBe('judgement');
    expect(setLocalHaptic).toHaveBeenCalledTimes(1);
    expect(setLocalHaptic).toHaveBeenLastCalledWith(false);
    leaveJudgementHaptic();
    expect(currentHapticMode()).toBe('local');
    expect(setLocalHaptic).toHaveBeenCalledTimes(2);
    expect(setLocalHaptic).toHaveBeenLastCalledWith(true);
  });

  it('겹쳐 진입해도 모드가 바뀔 때만 보내고, 마지막 이탈에서만 local로 돌아간다', () => {
    enterJudgementHaptic();
    enterJudgementHaptic();
    expect(setLocalHaptic).toHaveBeenCalledTimes(1);
    leaveJudgementHaptic();
    expect(currentHapticMode()).toBe('judgement');
    expect(setLocalHaptic).toHaveBeenCalledTimes(1);
    leaveJudgementHaptic();
    expect(currentHapticMode()).toBe('local');
    expect(setLocalHaptic).toHaveBeenCalledTimes(2);
  });

  it('진입 없이 이탈해도 아무것도 보내지 않는다', () => {
    leaveJudgementHaptic();
    expect(setLocalHaptic).not.toHaveBeenCalled();
    enterJudgementHaptic();
    expect(currentHapticMode()).toBe('judgement');
  });

  it('onStickLinked는 그 손에만 현재 모드 값(local 1, judgement 0)을 보낸다', () => {
    onStickLinked(1);
    expect(setLocalHaptic).toHaveBeenLastCalledWith(true, 1);
    enterJudgementHaptic();
    onStickLinked(0);
    expect(setLocalHaptic).toHaveBeenLastCalledWith(false, 0);
  });

  it('pagehide는 judgement일 때만 local(1)을 전체에 보내 본다', () => {
    pageHideForTest();
    expect(setLocalHaptic).not.toHaveBeenCalled();
    enterJudgementHaptic();
    setLocalHaptic.mockClear();
    pageHideForTest();
    expect(setLocalHaptic).toHaveBeenCalledWith(true);
  });
});
