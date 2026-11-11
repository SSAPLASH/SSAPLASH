// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaneLegend } from './LaneLegend';

afterEach(cleanup);

describe('LaneLegend 상호작용', () => {
  it('칸에 올리면 그 패드, 벗어나면 null을 onHoverPad로 알린다', () => {
    const onHoverPad = vi.fn();
    const { container } = render(<LaneLegend onHoverPad={onHoverPad} />);
    const cell = container.querySelectorAll('li.play-sl-cell')[3];
    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);
    expect(onHoverPad.mock.calls).toEqual([['SNARE'], [null]]);
  });

  it('포커스·블러도 같은 콜백으로 전달한다', () => {
    const onHoverPad = vi.fn();
    const { container } = render(<LaneLegend onHoverPad={onHoverPad} />);
    const cell = container.querySelectorAll('li.play-sl-cell')[5];
    fireEvent.focus(cell);
    fireEvent.blur(cell);
    expect(onHoverPad.mock.calls).toEqual([['KICK'], [null]]);
  });

  it('onHoverPad가 없어도 올려 보는 것이 오류가 아니다', () => {
    const { container } = render(<LaneLegend />);
    const cell = container.querySelectorAll('li.play-sl-cell')[0];
    expect(() => {
      fireEvent.mouseEnter(cell);
      fireEvent.mouseLeave(cell);
    }).not.toThrow();
  });

  it('칸은 키보드로 포커스할 수 있다', () => {
    const { container } = render(<LaneLegend />);
    container.querySelectorAll('li.play-sl-cell').forEach((c) => expect(c.getAttribute('tabindex')).toBe('0'));
  });
});
