// @vitest-environment happy-dom
// useReveal: 마운트 후 숨겼다가 화면에 들어오면 나타내고 관찰을 해제한다. 모션 줄이기·관찰자 없음은 처음부터 보인다.
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinClass, useReveal } from './useReveal';

const motionState = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motionState.reduce,
}));

type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let ioCallback: IoCallback | null;
let disconnect: ReturnType<typeof vi.fn>;
let options: IntersectionObserverInit | undefined;

function Probe({ index }: { index: number }) {
  const rRef = useRef<HTMLDivElement>(null);
  const r = useReveal(rRef, index);
  return (
    <div ref={rRef} data-testid="probe" className={joinClass('base', r.className)} style={r.style}>
      내용
    </div>
  );
}

beforeEach(() => {
  motionState.reduce = false;
  ioCallback = null;
  options = undefined;
  disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IoCallback, opts?: IntersectionObserverInit) {
        ioCallback = cb;
        options = opts;
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

describe('useReveal', () => {
  it('마운트 후 숨기고(lp-reveal), 들어오면 lp-in을 붙이며 관찰을 해제한다', () => {
    const { getByTestId } = render(<Probe index={5} />);
    const el = getByTestId('probe');
    expect(el.className).toBe('base lp-reveal');
    expect(el.style.transitionDelay).toBe('80ms'); // (5 % 4) * 80
    expect(options?.threshold).toBe(0.2);

    act(() => ioCallback!([{ isIntersecting: false }]));
    expect(el.className).toBe('base lp-reveal');
    expect(disconnect).not.toHaveBeenCalled();

    act(() => ioCallback!([{ isIntersecting: true }]));
    expect(el.className).toBe('base lp-reveal lp-in');
    expect(disconnect).toHaveBeenCalled();
  });

  it('모션 줄이기면 처음부터 보인다(클래스 없음)', () => {
    motionState.reduce = true;
    const { getByTestId } = render(<Probe index={0} />);
    expect(getByTestId('probe').className).toBe('base');
    expect(ioCallback).toBeNull();
  });

  it('IntersectionObserver가 없으면 숨기지 않는다', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { getByTestId } = render(<Probe index={0} />);
    expect(getByTestId('probe').className).toBe('base');
  });
});
