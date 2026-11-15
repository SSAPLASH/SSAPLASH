// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TimingBar, TIMING_BAR_H, TIMING_BAR_THIN_H } from './TimingBar';

const source = () => () => {};
afterEach(cleanup);

describe('TimingBar 모양(설계 MODE-003-practice-speed D18·D19)', () => {
  it('기본은 캔버스 하나뿐이고 글자가 없다(리듬 게임)', () => {
    const { container } = render(<TimingBar source={source} perfectMs={25} goodMs={60} />);
    const canvas = container.querySelector('canvas.timing-bar')!;
    expect(container.firstElementChild).toBe(canvas);
    expect(canvas.classList.contains('thin')).toBe(false);
    expect(canvas.getAttribute('height')).toBe(String(TIMING_BAR_H));
    expect(container.textContent).toBe('');
  });

  it('labels면 막대 왼쪽에 「빠름」, 오른쪽에 「느림」을 단다. 표시용이라 스크린리더에는 감춘다', () => {
    const { container } = render(<TimingBar source={source} perfectMs={25} goodMs={60} labels />);
    const row = container.querySelector('.timing-bar-row')!;
    expect(row.getAttribute('aria-hidden')).toBe('true');
    expect([...row.children].map((c) => (c.tagName === 'CANVAS' ? '[막대]' : c.textContent))).toEqual(['빠름', '[막대]', '느림']);
  });

  it('thin이면 얇은 캔버스(높이 9)와 thin 클래스를 쓴다', () => {
    const { container } = render(<TimingBar source={source} perfectMs={25} goodMs={60} thin labels />);
    const canvas = container.querySelector('canvas.timing-bar')!;
    expect(canvas.classList.contains('thin')).toBe(true);
    expect(canvas.getAttribute('height')).toBe(String(TIMING_BAR_THIN_H));
    expect(container.querySelector('.timing-bar-row')!.classList.contains('thin')).toBe(true);
  });
});
