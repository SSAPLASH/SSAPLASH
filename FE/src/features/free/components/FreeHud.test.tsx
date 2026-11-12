// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FreeHud } from './FreeHud';

afterEach(() => cleanup());

const q = (c: HTMLElement, sel: string) => c.querySelector<HTMLElement>(sel);

describe('FreeHud 표시 규칙', () => {
  it('타격 전: 패드 「—」(흐린 색), 손·세기 줄 없음, 타격 0회, 평균 세기 「—」', () => {
    const { container } = render(<FreeHud hand={null} total={0} mean={null} />);
    const pad = q(container, '.free-hud-pad')!;
    expect(pad.textContent).toBe('—');
    expect(pad.classList.contains('is-nil')).toBe(true);
    expect(q(container, '.free-hud-meta')).toBeNull();
    const stats = [...container.querySelectorAll('.free-hud-stats b')].map((b) => b.textContent);
    expect(stats).toEqual(['0회', '—']);
    expect(container.querySelectorAll('.free-hud-stats b')[1].classList.contains('is-nil')).toBe(true);
  });

  it('스틱 패드: 왼손·오른손과 손 점 색 구분, 세기 반올림 + 막대(세기 ÷ 127)', () => {
    const { container, rerender } = render(<FreeHud pad="SNARE" hand={0} velocity={63.6} total={3} mean={80.4} />);
    expect(q(container, '.free-hud-pad')?.textContent).toBe('스네어');
    expect(q(container, '.free-hud-meta')?.textContent).toContain('왼손');
    expect(q(container, '.free-hud-hand')?.dataset.hand).toBe('left');
    expect(q(container, '.free-hud-num')?.textContent).toBe('64');
    expect(q(container, '.free-hud-vbar i')?.style.width).toBe(`${(64 / 127) * 100}%`);
    rerender(<FreeHud pad="CRASH" hand={1} velocity={127} total={4} mean={90} />);
    expect(q(container, '.free-hud-meta')?.textContent).toContain('오른손');
    expect(q(container, '.free-hud-hand')?.dataset.hand).toBe('right');
    expect(q(container, '.free-hud-vbar i')?.style.width).toBe('100%');
  });

  it('킥·하이햇 페달은 손 자리에 「발」(점은 중립색)', () => {
    for (const pad of ['KICK', 'HIHAT_PEDAL'] as const) {
      const { container, unmount } = render(<FreeHud pad={pad} hand={1} velocity={100} total={1} mean={100} />);
      expect(q(container, '.free-hud-meta')?.textContent).toContain('발');
      expect(q(container, '.free-hud-meta')?.textContent).not.toContain('오른손');
      expect(q(container, '.free-hud-hand')?.dataset.hand).toBe('none');
      unmount();
    }
  });

  it('손을 모르는 스틱 패드(키보드·터치)는 손 점·손 글자 없이 세기만 보인다', () => {
    const { container } = render(<FreeHud pad="SNARE" hand={null} velocity={100} total={1} mean={100} />);
    expect(q(container, '.free-hud-meta')?.textContent).toBe('세기100');
    expect(q(container, '.free-hud-hand')).toBeNull();
  });

  it('타격 수 「회」, 평균 세기는 반올림', () => {
    const { container } = render(<FreeHud pad="SNARE" hand={0} velocity={90} total={12} mean={87.5} />);
    const stats = [...container.querySelectorAll('.free-hud-stats b')].map((b) => b.textContent);
    expect(stats).toEqual(['12회', '88']);
  });
});
