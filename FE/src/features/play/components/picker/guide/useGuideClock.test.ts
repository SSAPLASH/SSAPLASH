// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGuideScript, holdStartOf, stateAt } from '@/features/play/domain/guideScript';
import { useGuideClock } from './useGuideClock';

const script = buildGuideScript();

// rAF를 손으로 돌린다: tick(ms)는 등록된 콜백을 한 번 부르고 시각을 ms만큼 옮긴다
let queue: Map<number, FrameRequestCallback>;
let id: number;
let clockNow: number;
function tick(ms: number) {
  clockNow += ms;
  const cbs = [...queue.values()];
  queue.clear();
  act(() => cbs.forEach((cb) => cb(clockNow)));
}

let ioCallback: ((e: Partial<IntersectionObserverEntry>[]) => void) | null;
let reducedMotion: boolean;

beforeEach(() => {
  queue = new Map();
  id = 0;
  clockNow = 1000;
  ioCallback = null;
  reducedMotion = false;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (h: number) => queue.delete(h));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reducedMotion && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (e: Partial<IntersectionObserverEntry>[]) => void) {
        ioCallback = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const setup = () => renderHook(() => useGuideClock(script, { current: document.createElement('div') }));

describe('useGuideClock', () => {
  it('프레임마다 경과 시간을 누적한다(첫 프레임은 기준만 잡는다)', () => {
    const { result } = setup();
    tick(0);
    tick(16);
    tick(16);
    expect(result.current.t).toBe(32);
    expect(result.current.paused).toBe(false);
  });

  it('toggle로 멈추면 누적하지 않고 다시 켜면 이어간다', () => {
    const { result } = setup();
    tick(0);
    tick(100);
    act(() => result.current.toggle());
    expect(result.current.paused).toBe(true);
    tick(500);
    expect(result.current.t).toBe(100);
    act(() => result.current.toggle());
    tick(0);
    tick(50);
    expect(result.current.t).toBe(150);
  });

  it('active=false(접힘)면 누적하지 않고 true로 돌아오면 이어간다', () => {
    const target = { current: document.createElement('div') };
    const { result, rerender } = renderHook(({ active }) => useGuideClock(script, target, active), { initialProps: { active: true } });
    tick(0);
    tick(100);
    expect(result.current.t).toBe(100);
    rerender({ active: false });
    tick(500);
    tick(500);
    expect(result.current.t).toBe(100);
    rerender({ active: true });
    tick(0);
    tick(50);
    expect(result.current.t).toBe(150);
  });

  it('stepTo(i)는 그 칸의 멈춤 시작으로 옮기고 멈춘다', () => {
    const { result } = setup();
    act(() => result.current.stepTo(3));
    expect(result.current.paused).toBe(true);
    expect(stateAt(script, result.current.t).active).toBe(3);
    expect(result.current.t).toBe(holdStartOf(script, 3) + 1);
  });

  it('모션 줄이기면 칸 0에 멈춘 채로 시작한다', () => {
    reducedMotion = true;
    const { result } = setup();
    expect(result.current.paused).toBe(true);
    expect(stateAt(script, result.current.t).active).toBe(0);
    tick(0);
    tick(100);
    expect(result.current.t).toBe(holdStartOf(script, 0) + 1);
  });

  it('화면 밖이면 누적을 멈추고 돌아오면 이어간다', () => {
    const { result } = setup();
    tick(0);
    tick(100);
    act(() => ioCallback?.([{ isIntersecting: false }]));
    tick(500);
    expect(result.current.t).toBe(100);
    act(() => ioCallback?.([{ isIntersecting: true }]));
    tick(0);
    tick(20);
    expect(result.current.t).toBe(120);
  });

  it('탭이 숨겨지면 누적을 멈춘다', () => {
    const { result } = setup();
    tick(0);
    tick(100);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    tick(500);
    expect(result.current.t).toBe(100);
  });

  it('IntersectionObserver가 없어도 돈다', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { result } = setup();
    tick(0);
    tick(30);
    expect(result.current.t).toBe(30);
  });

  it('긴 정지 뒤 첫 프레임은 한 프레임 상한으로 자른다', () => {
    const { result } = setup();
    tick(0);
    tick(10000);
    expect(result.current.t).toBe(250);
  });
});
