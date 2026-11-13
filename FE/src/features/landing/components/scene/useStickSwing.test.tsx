// @vitest-environment happy-dom
// useStickSwing: 화면 안에서만 rAF를 돌리고, 화면 밖·언마운트·비활성에서 정리하며, onFrame에 경과 초를 넘긴다.
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStickSwing } from './useStickSwing';

type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let ioCallback: IoCallback | null;
let disconnect: ReturnType<typeof vi.fn>;
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextId: number;
let raf: ReturnType<typeof vi.fn>;
let caf: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ioCallback = null;
  disconnect = vi.fn();
  rafCallbacks = new Map();
  nextId = 1;
  raf = vi.fn((cb: FrameRequestCallback) => {
    const id = nextId++;
    rafCallbacks.set(id, cb);
    return id;
  });
  caf = vi.fn((id: number) => void rafCallbacks.delete(id));
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IoCallback) {
        ioCallback = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 예약된 rAF 콜백 하나를 지정한 시각(ms)으로 실행한다 */
function frame(ms: number) {
  const [id, cb] = [...rafCallbacks.entries()][0];
  rafCallbacks.delete(id);
  cb(ms);
}

function setup(enabled = true) {
  const onFrame = vi.fn();
  const stage = document.createElement('div');
  const stageRef = { current: stage };
  const view = renderHook((props: { enabled: boolean }) => useStickSwing({ stageRef, enabled: props.enabled, onFrame }), {
    initialProps: { enabled },
  });
  return { onFrame, ...view };
}

describe('useStickSwing', () => {
  it('enabled가 false면 관찰도 rAF도 하지 않는다', () => {
    setup(false);
    expect(ioCallback).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it('화면에 들어오기 전에는 rAF를 돌리지 않는다', () => {
    setup();
    expect(ioCallback).not.toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it('화면 안이면 rAF를 돌리고, 밖으로 나가면 cancelAnimationFrame으로 멈춘다', () => {
    const { onFrame } = setup();
    ioCallback!([{ isIntersecting: true }]);
    expect(raf).toHaveBeenCalledTimes(1);
    frame(1000); // 시작 시각
    expect(onFrame).toHaveBeenLastCalledWith(0); // 시작 프레임은 0초
    expect(raf).toHaveBeenCalledTimes(2);

    ioCallback!([{ isIntersecting: false }]);
    expect(caf).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.size).toBe(0);

    // 다시 들어오면 다시 돈다
    ioCallback!([{ isIntersecting: true }]);
    expect(raf).toHaveBeenCalledTimes(3);
  });

  it('언마운트하면 rAF를 취소하고 관찰을 해제한다', () => {
    const { unmount } = setup();
    ioCallback!([{ isIntersecting: true }]);
    unmount();
    expect(caf).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(rafCallbacks.size).toBe(0);
  });

  it('enabled가 true에서 false로 바뀌면 멈춘다', () => {
    const { rerender } = setup();
    ioCallback!([{ isIntersecting: true }]);
    rerender({ enabled: false });
    expect(caf).toHaveBeenCalled();
    expect(rafCallbacks.size).toBe(0);
  });

  it('onFrame에 루프 시작 뒤 지난 초를 넘기고, 화면에 다시 들어오면 0부터 센다', () => {
    const { onFrame } = setup();
    ioCallback!([{ isIntersecting: true }]);
    frame(2000); // 시작
    frame(2500);
    expect(onFrame).toHaveBeenLastCalledWith(0.5);
    frame(3250);
    expect(onFrame).toHaveBeenLastCalledWith(1.25);

    ioCallback!([{ isIntersecting: false }]);
    ioCallback!([{ isIntersecting: true }]);
    frame(9000);
    expect(onFrame).toHaveBeenLastCalledWith(0);
    frame(9100);
    expect(onFrame).toHaveBeenLastCalledWith(0.1);
  });

  it('IntersectionObserver가 없는 환경에서는 돌리지 않는다', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    setup();
    expect(raf).not.toHaveBeenCalled();
  });
});
