// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideFold } from './GuideFold';

beforeEach(() => {
  localStorage.clear();
  // 모션 줄이기: 안내 시계가 첫 칸에 멈춘 채로 시작해 rAF 없이 결정적이다
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)', addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bar = () => document.querySelector('.guide-fold-bar') as HTMLButtonElement;
const inner = () => document.querySelector('.guide-fold-inner') as HTMLElement;
const isInert = () => inner().hasAttribute('inert');

describe('GuideFold', () => {
  it('저장값이 없으면 펼친 채 시작한다', () => {
    render(<GuideFold mode="sheet" />);
    expect(bar().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: '악보 연습 안내' })).toBeTruthy();
    expect(isInert()).toBe(false);
    expect(bar().textContent).toContain('접기');
    expect(bar().getAttribute('aria-controls')).toBe(document.querySelector('.guide-fold-body')?.id);
  });

  it('바를 누르면 접히고(inert) 라벨이 「펼치기」, 저장소에 접힘(1)이 남는다', () => {
    render(<GuideFold mode="sheet" />);
    fireEvent.click(bar());
    expect(bar().getAttribute('aria-expanded')).toBe('false');
    expect(isInert()).toBe(true);
    expect(bar().textContent).toContain('펼치기');
    expect(document.querySelector('.guide-fold')?.classList.contains('open')).toBe(false);
    expect(localStorage.getItem('airdrum.picker.guideFold.sheet')).toBe('1');
    fireEvent.click(bar());
    expect(bar().getAttribute('aria-expanded')).toBe('true');
    expect(isInert()).toBe(false);
    expect(localStorage.getItem('airdrum.picker.guideFold.sheet')).toBe('0');
  });

  it('다시 마운트해도 접힌 채다', () => {
    const first = render(<GuideFold mode="sheet" />);
    fireEvent.click(bar());
    first.unmount();
    render(<GuideFold mode="sheet" />);
    expect(bar().getAttribute('aria-expanded')).toBe('false');
    expect(isInert()).toBe(true);
  });

  it('play는 sheet의 저장값에 영향받지 않는다', () => {
    localStorage.setItem('airdrum.picker.guideFold.sheet', '1');
    render(<GuideFold mode="play" />);
    expect(bar().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(bar());
    expect(localStorage.getItem('airdrum.picker.guideFold.play')).toBe('1');
    expect(localStorage.getItem('airdrum.picker.guideFold.sheet')).toBe('1');
  });

  it('play 문구를 쓴다', () => {
    render(<GuideFold mode="play" />);
    expect(screen.getByRole('region', { name: '리듬 게임 안내' })).toBeTruthy();
    expect(bar().textContent).toContain('리듬 게임 안내');
    expect(bar().textContent).toContain('노트가 판정선에 닿을 때, 그 레인의 패드를 쳐요');
  });

  it('sheet 문구를 쓴다', () => {
    render(<GuideFold mode="sheet" />);
    expect(bar().textContent).toContain('악보 연습 안내');
    expect(bar().textContent).toContain('세로선이 음표에 닿을 때, 그 음표가 놓인 줄의 패드를 쳐요');
  });

  it('mode가 바뀌면 그 모드의 저장값을 따른다', () => {
    localStorage.setItem('airdrum.picker.guideFold.sheet', '1');
    const { rerender } = render(<GuideFold mode="sheet" />);
    expect(bar().getAttribute('aria-expanded')).toBe('false');
    rerender(<GuideFold mode="play" />);
    expect(bar().getAttribute('aria-expanded')).toBe('true');
    expect(bar().textContent).toContain('리듬 게임 안내');
    localStorage.setItem('airdrum.picker.guideFold.play', '1');
    rerender(<GuideFold mode="sheet" />);
    expect(bar().getAttribute('aria-expanded')).toBe('false');
    rerender(<GuideFold mode="play" />);
    expect(bar().getAttribute('aria-expanded')).toBe('false');
  });
});
