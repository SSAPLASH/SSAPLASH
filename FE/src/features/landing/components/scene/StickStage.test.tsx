// @vitest-environment happy-dom
// StickStage: 캔버스를 쓸 수 없어도 렌더되고, 모션 줄이기면 rAF 없이 한 장 그리며, 언마운트 때 관찰·루프를 정리한다.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StickStage } from './StickStage';

type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let raf: ReturnType<typeof vi.fn>;
let caf: ReturnType<typeof vi.fn>;
let ioCallback: IoCallback | null;
let ioDisconnect: ReturnType<typeof vi.fn>;
let roDisconnect: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.fn>;
let calls: Record<string, number>;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

// 호출 횟수만 기록하는 가짜 2D 컨텍스트
function fakeContext() {
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return () => {
        calls[prop] = (calls[prop] ?? 0) + 1;
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
}

beforeEach(() => {
  calls = {};
  ioCallback = null;
  ioDisconnect = vi.fn();
  roDisconnect = vi.fn();
  raf = vi.fn(() => 1);
  caf = vi.fn();
  getContext = vi.fn(() => fakeContext());
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IoCallback) {
        ioCallback = cb;
      }
      observe() {}
      disconnect = ioDisconnect;
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = roDisconnect;
    },
  );
  HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 520,
    height: 520,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 520,
    bottom: 520,
    toJSON() {},
  });
});

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StickStage', () => {
  it('캔버스(aria-hidden)를 .lp-stage 안에 그린다', () => {
    const { container } = render(<StickStage step={0} reduce={false} />);
    const stage = container.querySelector('.lp-stage');
    expect(stage?.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('getContext가 null이어도 렌더되고 아무것도 예약하지 않는다', () => {
    getContext.mockReturnValue(null);
    const { container, unmount } = render(<StickStage step={1} reduce={true} />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(raf).not.toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });

  it('reduce면 rAF를 예약하지 않고 정지 화면을 한 번 그린다', () => {
    render(<StickStage step={0} reduce={true} />);
    expect(raf).not.toHaveBeenCalled();
    expect(ioCallback).toBeNull(); // 화면 관찰도 하지 않는다
    expect(calls.clearRect).toBe(1);
    expect(calls.fill).toBeGreaterThan(50);
  });

  it('reduce가 아니면 화면에 들어올 때 rAF를 돌리고 나가면 멈춘다', () => {
    render(<StickStage step={1} reduce={false} />);
    expect(raf).not.toHaveBeenCalled();
    ioCallback!([{ isIntersecting: true }]);
    expect(raf).toHaveBeenCalledTimes(1);
    ioCallback!([{ isIntersecting: false }]);
    expect(caf).toHaveBeenCalledTimes(1);
  });

  it('프레임이 오면 그린다', () => {
    render(<StickStage step={2} reduce={false} />);
    ioCallback!([{ isIntersecting: true }]);
    const cb = raf.mock.calls[0][0] as FrameRequestCallback;
    cb(1000);
    expect(calls.clearRect).toBe(1);
  });

  it('언마운트하면 크기·화면 관찰을 해제하고 rAF를 취소한다', () => {
    const { unmount } = render(<StickStage step={1} reduce={false} />);
    ioCallback!([{ isIntersecting: true }]);
    unmount();
    expect(roDisconnect).toHaveBeenCalled();
    expect(ioDisconnect).toHaveBeenCalled();
    expect(caf).toHaveBeenCalled();
  });
});
