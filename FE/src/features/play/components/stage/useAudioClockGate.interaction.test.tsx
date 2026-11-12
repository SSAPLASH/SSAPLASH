// @vitest-environment happy-dom
// 시작·재개 전 오디오 시계 대기 훅 (설계 MODE-001 오디오 시계 시작 대기 A6·A7)
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockWaitResult } from '@/audio/AudioEngine';
import { diagTap, type DiagEvent } from '@/engine/diagTap';
import { AudioWaitNotice } from './AudioWaitNotice';
import { AUDIO_WAIT_NOTICE_MS, useAudioClockGate } from './useAudioClockGate';

const OK: ClockWaitResult = { waitedMs: 160, timedOut: false, skipped: false, primed: false };

/** 바깥에서 끝낼 수 있는 대기 */
function deferred() {
  let done!: (r: ClockWaitResult) => void;
  const wait = vi.fn(() => new Promise<ClockWaitResult>((r) => (done = r)));
  return { wait, done: (r: ClockWaitResult = OK) => done(r) };
}

const events: DiagEvent[] = [];
let unsub: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  unsub = diagTap.subscribe((e) => events.push(e));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  unsub?.();
  events.length = 0;
});

describe('useAudioClockGate', () => {
  it('대기가 끝나면 참을 돌려주고 진단 이벤트를 낸다', async () => {
    const d = deferred();
    const { result } = renderHook(() => useAudioClockGate({ wait: d.wait }));
    let ok: boolean | null = null;
    act(() => {
      void result.current.wait('begin').then((v) => (ok = v));
    });
    await act(async () => d.done({ waitedMs: 860, timedOut: false, skipped: false, primed: true }));
    expect(ok).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'audioClockWait', phase: 'begin', waitedMs: 860, timedOut: false, skipped: false, primed: true }));
  });

  it('기다리는 중에 다시 부르면 거짓을 돌려주고 대기를 새로 시작하지 않는다(A6)', async () => {
    const d = deferred();
    const { result } = renderHook(() => useAudioClockGate({ wait: d.wait }));
    let first: boolean | null = null;
    let second: boolean | null = null;
    act(() => {
      void result.current.wait('resume').then((v) => (first = v));
      void result.current.wait('resume').then((v) => (second = v));
    });
    await act(async () => d.done());
    expect(d.wait).toHaveBeenCalledTimes(1);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('끝난 뒤에는 다시 기다릴 수 있다', async () => {
    const d = deferred();
    const { result } = renderHook(() => useAudioClockGate({ wait: d.wait }));
    act(() => void result.current.wait('begin'));
    await act(async () => d.done());
    act(() => void result.current.wait('restart'));
    expect(d.wait).toHaveBeenCalledTimes(2);
  });

  it('기다리는 사이 화면을 떠나면 거짓을 돌려준다(A6)', async () => {
    const d = deferred();
    const { result, unmount } = renderHook(() => useAudioClockGate({ wait: d.wait }));
    let ok: boolean | null = null;
    act(() => {
      void result.current.wait('begin').then((v) => (ok = v));
    });
    unmount();
    await act(async () => d.done());
    expect(ok).toBe(false);
  });

  it('400ms를 넘으면 안내를 켜고, 끝나면 끈다(A7)', async () => {
    const d = deferred();
    const { result } = renderHook(() => useAudioClockGate({ wait: d.wait }));
    act(() => void result.current.wait('begin'));
    expect(result.current.notice).toBe(false);
    act(() => void vi.advanceTimersByTime(AUDIO_WAIT_NOTICE_MS - 1));
    expect(result.current.notice).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.notice).toBe(true);
    await act(async () => d.done());
    expect(result.current.notice).toBe(false);
  });

  it('400ms 안에 끝나면 안내가 켜지지 않는다', async () => {
    const d = deferred();
    const { result } = renderHook(() => useAudioClockGate({ wait: d.wait }));
    act(() => void result.current.wait('begin'));
    act(() => void vi.advanceTimersByTime(160));
    await act(async () => d.done());
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.notice).toBe(false);
  });
});

describe('AudioWaitNotice', () => {
  it('보일 때만 문구를 그린다', () => {
    const { rerender } = render(<AudioWaitNotice show={false} />);
    expect(screen.queryByText('오디오 준비 중…')).toBeNull();
    rerender(<AudioWaitNotice show />);
    expect(screen.getByRole('status').textContent).toBe('오디오 준비 중…');
  });
});
