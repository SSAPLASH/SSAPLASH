// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const setPoseStream = vi.fn();
vi.mock('@/runtime/sources', () => ({ inputManager: { setPoseStream: (v: boolean) => setPoseStream(v) } }));

import { usePoseStream } from './usePoseStream';

afterEach(() => {
  cleanup();
  setPoseStream.mockClear();
});

describe('usePoseStream', () => {
  it('꺼져 있으면 보내지 않는다', () => {
    renderHook(() => usePoseStream(false));
    expect(setPoseStream).not.toHaveBeenCalled();
  });

  it('켜지면 true, 꺼지면 false', () => {
    const { rerender } = renderHook(({ on }) => usePoseStream(on), { initialProps: { on: true } });
    expect(setPoseStream).toHaveBeenLastCalledWith(true);
    rerender({ on: false });
    expect(setPoseStream).toHaveBeenLastCalledWith(false);
  });

  it('언마운트하면 false', () => {
    const { unmount } = renderHook(() => usePoseStream(true));
    unmount();
    expect(setPoseStream).toHaveBeenLastCalledWith(false);
  });

  it('연결 수가 바뀌면 true를 다시 보낸다', () => {
    const { rerender } = renderHook(({ n }) => usePoseStream(true, n), { initialProps: { n: 1 } });
    setPoseStream.mockClear();
    rerender({ n: 2 });
    expect(setPoseStream).toHaveBeenLastCalledWith(true);
  });
});
