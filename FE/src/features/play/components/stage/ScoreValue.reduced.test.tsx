// @vitest-environment happy-dom
// 모션 줄이기(OS 설정)에서는 점수가 보간 없이 즉시 반영된다. useReducedMotion을 true로 고정해 확인한다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('motion/react', async (orig) => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }));

import { ScoreValue } from './PlayHud';

afterEach(cleanup);

describe('ScoreValue 모션 줄이기', () => {
  it('새 점수가 즉시 반영되고 번쩍이지 않는다', () => {
    const { container, rerender } = render(<ScoreValue score={100} />);
    const el = container.querySelector('[data-stat="score"]') as HTMLElement;
    el.animate = vi.fn() as unknown as typeof el.animate;
    rerender(<ScoreValue score={5000} />);
    expect(el.textContent).toBe('5,000');
    expect(el.animate).not.toHaveBeenCalled();
  });
});
