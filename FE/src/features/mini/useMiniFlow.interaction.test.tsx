// @vitest-environment happy-dom
// useMiniFlow 검증: 카운트다운·제한 시간·마무리 타이머와 단계 전이를 가짜 타이머로 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMiniFlow, type MiniFlowOptions } from './useMiniFlow';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(options: MiniFlowOptions) {
  return renderHook(() => useMiniFlow(options));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** intro에서 playing까지 */
function toPlaying(hook: ReturnType<typeof setup>) {
  act(() => hook.result.current.start());
  advance(3000);
}

describe('useMiniFlow 카운트다운', () => {
  it('처음은 intro이고 countdown·startedAt은 null', () => {
    const { result } = setup({ closingMs: 250 });
    expect(result.current.phase).toBe('intro');
    expect(result.current.countdown).toBeNull();
    expect(result.current.startedAt).toBeNull();
  });

  it('start() → countdown 3 → 1초마다 2, 1 → playing', () => {
    const hook = setup({ closingMs: 250 });
    act(() => hook.result.current.start());
    expect(hook.result.current.phase).toBe('countdown');
    expect(hook.result.current.countdown).toBe(3);
    expect(hook.result.current.startedAt).toBeNull();

    advance(1000);
    expect(hook.result.current.countdown).toBe(2);
    advance(1000);
    expect(hook.result.current.countdown).toBe(1);

    advance(1000);
    expect(hook.result.current.phase).toBe('playing');
    expect(hook.result.current.countdown).toBeNull();
    // 가짜 타이머에서 performance.now()도 같이 흐른다 — 넘어온 그 순간의 값이다
    expect(hook.result.current.startedAt).toBe(performance.now());
  });
});

describe('useMiniFlow 제한 시간으로 끝나는 길', () => {
  it('playMs 뒤 closing, closingMs 뒤 result. startedAt은 남는다', () => {
    const hook = setup({ playMs: 10_000, closingMs: 250 });
    toPlaying(hook);
    const startedAt = hook.result.current.startedAt;
    expect(startedAt).toEqual(expect.any(Number));

    advance(9999);
    expect(hook.result.current.phase).toBe('playing');
    advance(1);
    expect(hook.result.current.phase).toBe('closing');
    expect(hook.result.current.startedAt).toBe(startedAt);

    advance(249);
    expect(hook.result.current.phase).toBe('closing');
    advance(1);
    expect(hook.result.current.phase).toBe('result');
    expect(hook.result.current.startedAt).toBe(startedAt);
  });
});

describe('useMiniFlow 화면이 끝내는 길', () => {
  it('playMs가 없으면 시간이 지나도 playing에 머문다', () => {
    const hook = setup({ closingMs: 400 });
    toPlaying(hook);
    advance(600_000);
    expect(hook.result.current.phase).toBe('playing');
  });

  it('finish()를 부르면 closing, closingMs 뒤 result', () => {
    const hook = setup({ closingMs: 400 });
    toPlaying(hook);
    const startedAt = hook.result.current.startedAt;
    act(() => hook.result.current.finish());
    expect(hook.result.current.phase).toBe('closing');
    advance(399);
    expect(hook.result.current.phase).toBe('closing');
    advance(1);
    expect(hook.result.current.phase).toBe('result');
    expect(hook.result.current.startedAt).toBe(startedAt);
  });

  it('finish()는 playing이 아닌 단계에서 아무 일도 없다', () => {
    const hook = setup({ closingMs: 400 });
    act(() => hook.result.current.finish());
    expect(hook.result.current.phase).toBe('intro');

    act(() => hook.result.current.start());
    act(() => hook.result.current.finish());
    expect(hook.result.current.phase).toBe('countdown');
    expect(hook.result.current.countdown).toBe(3);

    advance(3000);
    act(() => hook.result.current.finish());
    advance(400);
    expect(hook.result.current.phase).toBe('result');
    act(() => hook.result.current.finish());
    expect(hook.result.current.phase).toBe('result');
  });
});

describe('useMiniFlow retry·quit', () => {
  it('retry()는 result에서 countdown으로 가고 숫자 3, startedAt null', () => {
    const hook = setup({ playMs: 10_000, closingMs: 250 });
    toPlaying(hook);
    advance(10_000);
    advance(250);
    expect(hook.result.current.phase).toBe('result');

    act(() => hook.result.current.retry());
    expect(hook.result.current.phase).toBe('countdown');
    expect(hook.result.current.countdown).toBe(3);
    expect(hook.result.current.startedAt).toBeNull();

    advance(3000);
    expect(hook.result.current.phase).toBe('playing');
    expect(hook.result.current.startedAt).toEqual(expect.any(Number));
  });

  it('retry()는 result가 아닌 단계에서 아무 일도 없다', () => {
    const hook = setup({ closingMs: 250 });
    act(() => hook.result.current.retry());
    expect(hook.result.current.phase).toBe('intro');
  });

  it.each(['countdown', 'playing', 'closing', 'result'] as const)('quit()은 %s에서 intro로 돌리고 이후 시간이 지나도 단계가 바뀌지 않는다', (target) => {
    const hook = setup({ playMs: 10_000, closingMs: 250 });
    act(() => hook.result.current.start());
    if (target !== 'countdown') advance(3000);
    if (target === 'closing') advance(10_000);
    if (target === 'result') {
      advance(10_000);
      advance(250);
    }
    expect(hook.result.current.phase).toBe(target);

    act(() => hook.result.current.quit());
    expect(hook.result.current.phase).toBe('intro');
    expect(hook.result.current.countdown).toBeNull();
    expect(hook.result.current.startedAt).toBeNull();

    advance(60_000);
    expect(hook.result.current.phase).toBe('intro');
  });

  it('quit() 뒤 다시 start()하면 처음부터 카운트다운한다', () => {
    const hook = setup({ playMs: 10_000, closingMs: 250 });
    toPlaying(hook);
    act(() => hook.result.current.quit());
    act(() => hook.result.current.start());
    expect(hook.result.current.phase).toBe('countdown');
    expect(hook.result.current.countdown).toBe(3);
  });
});
