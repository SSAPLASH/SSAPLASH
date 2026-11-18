// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react';
import type { Judgement } from '@/domain/play/judgement';
import { COMBO_BREAK_MS, ComboDisplay } from './ComboDisplay';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

type P = { combo: number; judgement: Judgement | null; at: number | null; placement?: 'top' | 'stage' };
const view = (p: P) => (
  <LazyMotion features={domMax} strict>
    <ComboDisplay {...p} />
  </LazyMotion>
);
const root = (c: HTMLElement) => c.querySelector('.combo-display') as HTMLElement;
const value = (c: HTMLElement) => c.querySelector('[data-combo-value]')?.textContent;

describe('ComboDisplay 단계', () => {
  it('콤보 2 미만이면 아무것도 그리지 않는다', () => {
    const { container } = render(view({ combo: 1, judgement: 'PERFECT', at: 1 }));
    expect(root(container).dataset.stage).toBe('hidden');
    expect(container.querySelector('.combo-display-inner')).toBeNull();
  });

  it('2부터 숫자와 COMBO 두 줄', () => {
    const { container, rerender } = render(view({ combo: 0, judgement: null, at: null }));
    rerender(view({ combo: 2, judgement: 'PERFECT', at: 1 }));
    expect(root(container).dataset.stage).toBe('show');
    expect(value(container)).toBe('2');
    expect(container.textContent).toContain('COMBO');
  });

  it('10은 pulse, 50은 burst(클래스), 그 사이 숫자만 갱신', () => {
    const { container, rerender } = render(view({ combo: 8, judgement: 'PERFECT', at: 1 }));
    rerender(view({ combo: 9, judgement: 'PERFECT', at: 2 }));
    expect(root(container).dataset.stage).toBe('show');
    rerender(view({ combo: 10, judgement: 'PERFECT', at: 3 }));
    expect(root(container).dataset.stage).toBe('pulse');
    expect(value(container)).toBe('10');
    rerender(view({ combo: 11, judgement: 'GOOD', at: 4 }));
    // 숫자는 갱신하되 같은 요소(재생 중 연출을 끊지 않음)
    expect(value(container)).toBe('11');
    rerender(view({ combo: 49, judgement: 'PERFECT', at: 5 }));
    rerender(view({ combo: 50, judgement: 'PERFECT', at: 6 }));
    expect(root(container).dataset.stage).toBe('burst');
    expect(container.querySelector('.combo-display-inner')?.classList.contains('is-burst')).toBe(true);
  });

  it('10 이상에서 MISS면 miss색 break로 끊기기 전 숫자를 흔든 뒤 숨는다', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(view({ combo: 12, judgement: 'PERFECT', at: 1 }));
    rerender(view({ combo: 0, judgement: 'MISS', at: 2 }));
    expect(root(container).dataset.stage).toBe('break');
    expect(container.querySelector('.combo-display-inner')?.classList.contains('is-break')).toBe(true);
    expect(value(container)).toBe('12');
    act(() => {
      vi.advanceTimersByTime(COMBO_BREAK_MS + 10);
    });
    expect(root(container).dataset.stage).toBe('hidden');
    expect(container.querySelector('.combo-display-inner')).toBeNull();
  });

  it('10 미만 MISS는 연출 없이 바로 숨는다', () => {
    const { container, rerender } = render(view({ combo: 5, judgement: 'PERFECT', at: 1 }));
    rerender(view({ combo: 0, judgement: 'MISS', at: 2 }));
    expect(root(container).dataset.stage).toBe('hidden');
  });

  it('같은 판정(at 동일)이 다시 와도 단계를 다시 계산하지 않는다', () => {
    const { container, rerender } = render(view({ combo: 9, judgement: 'PERFECT', at: 1 }));
    rerender(view({ combo: 10, judgement: 'PERFECT', at: 2 }));
    const seq = container.querySelector('.combo-display-inner')?.getAttribute('data-seq');
    rerender(view({ combo: 10, judgement: 'PERFECT', at: 2 }));
    expect(container.querySelector('.combo-display-inner')?.getAttribute('data-seq')).toBe(seq);
  });

  it('판정 없는 상태로 돌아오면(다시 시작) 연출 없이 숨는다', () => {
    const { container, rerender } = render(view({ combo: 30, judgement: 'PERFECT', at: 1 }));
    rerender(view({ combo: 0, judgement: null, at: null }));
    expect(root(container).dataset.stage).toBe('hidden');
  });

  it('위치 클래스: 기본 top, B는 stage', () => {
    const a = render(view({ combo: 3, judgement: 'PERFECT', at: 1 }));
    expect(root(a.container).className).toContain('combo-display--top');
    a.unmount();
    const b = render(view({ combo: 3, judgement: 'PERFECT', at: 1, placement: 'stage' }));
    expect(root(b.container).className).toContain('combo-display--stage');
  });
});
