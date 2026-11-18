// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Pose, StickId } from '@/domain/events';

type PoseListener = (stickId: StickId, pose: Pose) => void;
const h = vi.hoisted(() => ({ listeners: new Set<(s: 0 | 1, p: { pitch: number; yaw: number }) => void>(), resetPose: vi.fn() }));
vi.mock('@/runtime/sources', () => ({
  inputManager: {
    onPose: (l: PoseListener) => {
      h.listeners.add(l);
      return () => h.listeners.delete(l);
    },
  },
}));
vi.mock('@/runtime/calibrationSession', () => ({ calibrationSession: { resetPose: () => h.resetPose() } }));

import { useReferenceCapture } from './useReferenceCapture';

let now = 0;
const STEP = 16;

/** 지정한 손들에 durMs 동안 같은 자세를 흘린다 */
function feed(hands: StickId[], durMs: number): void {
  const end = now + durMs;
  for (; now <= end; now += STEP) {
    act(() => {
      for (const s of hands) for (const l of [...h.listeners]) l(s, { pitch: 0, yaw: 0 });
    });
  }
}

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  h.listeners.clear();
  h.resetPose.mockClear();
  vi.restoreAllMocks();
});

describe('useReferenceCapture', () => {
  it('start 전에는 idle이고 구독하지 않는다', () => {
    const { result } = renderHook(() => useReferenceCapture([0, 1]));
    expect(result.current.phase).toBe('idle');
    expect(h.listeners.size).toBe(0);
  });

  it('양손 모두 3초 안정이면 resetPose 1회, done', () => {
    const { result } = renderHook(() => useReferenceCapture([0, 1]));
    act(() => result.current.start());
    expect(result.current.phase).toBe('holding');
    feed([0, 1], 3200);
    expect(result.current.phase).toBe('done');
    expect(h.resetPose).toHaveBeenCalledTimes(1);
    expect(h.listeners.size).toBe(0);
    feed([0, 1], 500);
    expect(h.resetPose).toHaveBeenCalledTimes(1);
  });

  it('한 손만 안정이면 미완료', () => {
    const { result } = renderHook(() => useReferenceCapture([0, 1]));
    act(() => result.current.start());
    feed([0], 3500);
    expect(result.current.phase).toBe('holding');
    expect(result.current.progress).toBe(0);
    expect(h.resetPose).not.toHaveBeenCalled();
  });

  it('진행 중 연결된 손이 바뀌면 처음부터', () => {
    const { result, rerender } = renderHook(({ hands }) => useReferenceCapture(hands), { initialProps: { hands: [0, 1] as StickId[] } });
    act(() => result.current.start());
    feed([0, 1], 1500);
    expect(result.current.progress).toBeGreaterThan(0.3);
    rerender({ hands: [0] });
    expect(result.current.phase).toBe('holding');
    expect(result.current.progress).toBe(0);
    feed([0], 3200);
    expect(result.current.phase).toBe('done');
    expect(h.resetPose).toHaveBeenCalledTimes(1);
  });

  it('손이 모두 사라지면 취소된다', () => {
    const { result, rerender } = renderHook(({ hands }) => useReferenceCapture(hands), { initialProps: { hands: [0] as StickId[] } });
    act(() => result.current.start());
    rerender({ hands: [] });
    expect(result.current.phase).toBe('idle');
    expect(h.listeners.size).toBe(0);
  });

  it('cancel은 resetPose 없이 idle로', () => {
    const { result } = renderHook(() => useReferenceCapture([0]));
    act(() => result.current.start());
    feed([0], 1000);
    act(() => result.current.cancel());
    expect(result.current.phase).toBe('idle');
    expect(h.listeners.size).toBe(0);
    feed([0], 3500);
    expect(h.resetPose).not.toHaveBeenCalled();
  });

  it('언마운트하면 구독을 해제한다', () => {
    const { result, unmount } = renderHook(() => useReferenceCapture([0]));
    act(() => result.current.start());
    unmount();
    expect(h.listeners.size).toBe(0);
  });
});
