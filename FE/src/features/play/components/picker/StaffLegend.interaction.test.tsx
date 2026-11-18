// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffLegend } from './StaffLegend';

afterEach(cleanup);

describe('StaffLegend 상호작용', () => {
  it('칸에 올리면 그 패드, 벗어나면 null을 onHoverPad로 알린다', () => {
    const onHoverPad = vi.fn();
    const { container } = render(<StaffLegend onHoverPad={onHoverPad} />);
    const cell = container.querySelectorAll('li.play-sl-cell')[5];
    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);
    expect(onHoverPad.mock.calls).toEqual([['SNARE'], [null]]);
  });

  it('포커스·블러도 같은 콜백으로 전달한다', () => {
    const onHoverPad = vi.fn();
    const { container } = render(<StaffLegend onHoverPad={onHoverPad} />);
    const cell = container.querySelectorAll('li.play-sl-cell')[7];
    fireEvent.focus(cell);
    fireEvent.blur(cell);
    expect(onHoverPad.mock.calls).toEqual([['KICK'], [null]]);
  });
});
