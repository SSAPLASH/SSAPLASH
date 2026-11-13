// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kitGuideLabels } from '@/domain/kit/kitGuide';
import { KitGuideLabels } from '@/components/drum/KitGuideLabels';
import { KitGuideSwitch } from './KitGuide';

afterEach(() => cleanup());

describe('KitGuideSwitch', () => {
  it('role="switch"·aria-checked·보이는 글자 「키트 가이드」', () => {
    render(<KitGuideSwitch on onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: '키트 가이드' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('누르면 반대 값으로 onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<KitGuideSwitch on onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(false);
    rerender(<KitGuideSwitch on={false} onChange={onChange} />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});

describe('KitGuideLabels', () => {
  const labels = kitGuideLabels('acoustic', true);

  it('묶음은 aria-hidden, 이름표마다 자리(%)와 키', () => {
    const { container } = render(<KitGuideLabels labels={labels} visible />);
    const group = container.querySelector('.free-plabels')!;
    expect(group.getAttribute('aria-hidden')).toBe('true');
    expect(group.classList.contains('is-off')).toBe(false);
    const snare = container.querySelector<HTMLElement>('[data-pad="SNARE"]')!;
    expect(snare.textContent).toBe('스네어FJ');
    expect([...snare.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['F', 'J']);
    expect(snare.style.left).toMatch(/%$/);
    expect(snare.style.top).toMatch(/%$/);
  });

  it('키가 없으면 kbd가 없다(스틱 소스)', () => {
    const { container } = render(<KitGuideLabels labels={kitGuideLabels('acoustic', false)} visible />);
    expect(container.querySelector('kbd')).toBeNull();
    expect(container.querySelector('[data-pad="KICK"]')?.textContent).toBe('킥');
  });

  it('꺼지면 DOM에 남기고 is-off로 숨긴다(전환용)', () => {
    const { container } = render(<KitGuideLabels labels={labels} visible={false} />);
    expect(container.querySelector('.free-plabels')?.classList.contains('is-off')).toBe(true);
    expect(container.querySelectorAll('.free-plabel')).toHaveLength(9);
  });

  it('친 패드의 이름표만 켜짐 표시(is-hit), 타격마다 새로 붙는다', () => {
    const { container, rerender } = render(<KitGuideLabels labels={labels} visible hitSeq={{ HIHAT_PEDAL: 1 }} />);
    expect(container.querySelector('[data-pad="HIHAT_PEDAL"]')?.classList.contains('is-hit')).toBe(true);
    expect(container.querySelector('[data-pad="HIHAT"]')?.classList.contains('is-hit')).toBe(false);
    const before = container.querySelector('[data-pad="HIHAT_PEDAL"]');
    rerender(<KitGuideLabels labels={labels} visible hitSeq={{ HIHAT_PEDAL: 2 }} />);
    expect(container.querySelector('[data-pad="HIHAT_PEDAL"]')).not.toBe(before);
  });
});
