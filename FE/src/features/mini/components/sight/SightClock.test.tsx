// @vitest-environment happy-dom
// SightClock 검증: 멈춘 값·대기·흐르는 값(가짜 타이머)·모션 줄이기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SightClock } from '@/features/mini/components/sight/SightClock';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const box = () => document.querySelector('.mini-sight-clock') as HTMLElement;
const value = () => screen.getByTestId('mini-sight-clock').textContent;

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

describe('SightClock 멈춘 값', () => {
  it('frozenMs가 있으면 그 값을 초로 보이고 status로 읽어 준다', () => {
    render(<SightClock shownAt={null} wrongs={0} frozenMs={1230} />);
    expect(value()).toBe('1.23');
    expect(box().classList.contains('is-frozen')).toBe(true);
    expect(box().getAttribute('role')).toBe('status');
    expect(box().hasAttribute('aria-hidden')).toBe(false);
  });

  it('shownAt이 있어도 frozenMs가 우선이고 흐르지 않는다', () => {
    render(<SightClock shownAt={performance.now()} wrongs={1} frozenMs={380} />);
    advance(1000);
    expect(value()).toBe('0.38');
    expect(box().classList.contains('is-frozen')).toBe(true);
  });
});

describe('SightClock 대기', () => {
  it('shownAt·frozenMs가 모두 없으면 0.00이고 낭독기에서 숨긴다', () => {
    render(<SightClock shownAt={null} wrongs={0} frozenMs={null} />);
    expect(value()).toBe('0.00');
    expect(box().classList.contains('is-idle')).toBe(true);
    expect(box().getAttribute('aria-hidden')).toBe('true');
    expect(box().hasAttribute('role')).toBe(false);
  });
});

describe('SightClock 흐르는 값', () => {
  it('제시 시각부터 흐르고 낭독기에서 숨긴다', () => {
    const shownAt = performance.now();
    render(<SightClock shownAt={shownAt} wrongs={0} frozenMs={null} />);
    expect(box().classList.contains('is-running')).toBe(true);
    expect(box().getAttribute('aria-hidden')).toBe('true');
    expect(value()).toBe('0.00');
    advance(300);
    const first = Number(value());
    expect(first).toBeGreaterThanOrEqual(0.28);
    expect(first).toBeLessThanOrEqual(0.3);
    advance(500);
    expect(Number(value())).toBeGreaterThan(first);
  });

  it('틀린 횟수 × 0.5초가 더해진다', () => {
    render(<SightClock shownAt={performance.now()} wrongs={2} frozenMs={null} />);
    // 첫 프레임 전에도 벌점은 보인다
    expect(value()).toBe('1.00');
    advance(200);
    const v = Number(value());
    expect(v).toBeGreaterThanOrEqual(1.18);
    expect(v).toBeLessThanOrEqual(1.2);
  });

  it('5.00을 넘지 않는다', () => {
    render(<SightClock shownAt={performance.now()} wrongs={3} frozenMs={null} />);
    advance(10_000);
    expect(value()).toBe('5.00');
    cleanup();
    render(<SightClock shownAt={performance.now()} wrongs={0} frozenMs={null} />);
    advance(9000);
    expect(value()).toBe('5.00');
  });

  it('다른 제시 시각으로 바뀌면 앞 값이 비치지 않는다', () => {
    const { rerender } = render(<SightClock shownAt={performance.now()} wrongs={0} frozenMs={null} />);
    advance(1000);
    expect(Number(value())).toBeGreaterThan(0.9);
    rerender(<SightClock shownAt={performance.now()} wrongs={0} frozenMs={null} />);
    expect(value()).toBe('0.00');
  });

  it('언마운트하면 프레임 반복을 멈춘다', () => {
    const { unmount } = render(<SightClock shownAt={performance.now()} wrongs={0} frozenMs={null} />);
    advance(100);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('SightClock 모션 줄이기', () => {
  it('흐르는 동안 숫자 대신 「–」를 보이고 멈춘 모양이다', () => {
    stubReducedMotion(true);
    render(<SightClock shownAt={performance.now()} wrongs={1} frozenMs={null} />);
    advance(500);
    expect(value()).toBe('–');
    expect(box().classList.contains('is-idle')).toBe(true);
    expect(box().classList.contains('is-running')).toBe(false);
    // 프레임 반복도 걸지 않는다
    expect(vi.getTimerCount()).toBe(0);
  });

  it('멈춘 값은 모션을 줄여도 그대로 보인다', () => {
    stubReducedMotion(true);
    render(<SightClock shownAt={null} wrongs={0} frozenMs={380} />);
    expect(value()).toBe('0.38');
  });

  it('모션을 줄이지 않으면 흐른다', () => {
    stubReducedMotion(false);
    render(<SightClock shownAt={performance.now()} wrongs={0} frozenMs={null} />);
    advance(300);
    expect(Number(value())).toBeGreaterThan(0.2);
  });
});
