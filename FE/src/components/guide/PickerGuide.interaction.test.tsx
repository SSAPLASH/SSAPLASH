// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PickerGuide } from './PickerGuide';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // 모션 줄이기: 칸 0에 멈춘 채로 시작해 장면이 결정적이다
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)', addEventListener() {}, removeEventListener() {} }));
});

const nowLine = () => document.querySelector('.guide-now') as HTMLElement;
const activeRows = () => [...document.querySelectorAll('.play-sl-row.active')].map((r) => r.getAttribute('aria-label')?.split(' — ')[0]);
const padStates = (s: string) => document.querySelectorAll(`.drum-pad[data-state="${s}"]`).length;

describe('PickerGuide', () => {
  it('play에서는 아무것도 그리지 않는다', () => {
    const { container } = render(<PickerGuide mode="play" />);
    expect(container.innerHTML).toBe('');
  });

  it('sheet: 안내 제목·설명·악보 읽는 법 카드를 함께 그린다', () => {
    render(<PickerGuide mode="sheet" />);
    expect(screen.getByRole('region', { name: '악보 연습 안내' })).toBeTruthy();
    expect(screen.getByText('악보 연습은 이렇게 해요')).toBeTruthy();
    expect(screen.getByRole('region', { name: '악보 읽는 법' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '이전 음표' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '다음 음표' })).toBeTruthy();
  });

  it('모션 줄이기면 첫 칸(크래시+킥 동시에)에 멈춰 시작하고 라벨이 「재생」', () => {
    render(<PickerGuide mode="sheet" />);
    expect(screen.getByRole('button', { name: '재생' })).toBeTruthy();
    expect(nowLine().textContent).toContain('지금 칠 것');
    expect(nowLine().textContent).toContain('크래시');
    expect(nowLine().textContent).toContain('킥');
    expect(nowLine().textContent).toContain('동시에');
    expect(activeRows().sort()).toEqual(['크래시', '킥']);
    expect(padStates('hit')).toBe(2);
  });

  it('▶/◀로 칸을 옮기면 「지금 칠 것」 문구와 강조 줄이 바뀐다', () => {
    render(<PickerGuide mode="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: '다음 음표' }));
    expect(nowLine().textContent).toContain('하이햇');
    expect(nowLine().textContent).not.toContain('크래시');
    expect(nowLine().textContent).not.toContain('동시에');
    expect(activeRows()).toEqual(['하이햇']);
    expect(padStates('hit')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '다음 음표' }));
    expect(nowLine().textContent).toContain('스네어');
    expect(nowLine().textContent).toContain('동시에');
    expect(activeRows().sort()).toEqual(['스네어', '하이햇']);

    fireEvent.click(screen.getByRole('button', { name: '이전 음표' }));
    fireEvent.click(screen.getByRole('button', { name: '이전 음표' }));
    expect(activeRows().sort()).toEqual(['크래시', '킥']);
    // 처음에서 ◀를 더 눌러도 넘어가지 않는다
    fireEvent.click(screen.getByRole('button', { name: '이전 음표' }));
    expect(activeRows().sort()).toEqual(['크래시', '킥']);
  });

  it('일시정지 ↔ 재생 라벨이 바뀐다', () => {
    render(<PickerGuide mode="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '재생' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(screen.getByRole('button', { name: '재생' })).toBeTruthy();
  });

  it('칸 이동은 멈춘 채로 둔다(재생 중에도 ▶를 누르면 「재생」으로 돌아온다)', () => {
    render(<PickerGuide mode="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    fireEvent.click(screen.getByRole('button', { name: '다음 음표' }));
    expect(screen.getByRole('button', { name: '재생' })).toBeTruthy();
  });

  it('악보 읽는 법 줄에 마우스를 올리면 킷의 그 패드가 예고(armed) 모양이 된다', () => {
    render(<PickerGuide mode="sheet" />);
    expect(padStates('armed')).toBe(0);
    const row = screen.getByRole('listitem', { name: /^스네어/ });
    fireEvent.mouseEnter(row);
    expect(padStates('armed')).toBe(1);
    // 시계는 그대로: 강조된 줄과 타격 패드는 그대로다
    expect(padStates('hit')).toBe(2);
    fireEvent.mouseLeave(row);
    expect(padStates('armed')).toBe(0);
  });

  it('장면은 소리·이펙트 캔버스 없이 킷만 그린다', () => {
    render(<PickerGuide mode="sheet" />);
    expect(document.querySelector('.drum-kit-fx')).toBeNull();
    expect(document.querySelector('.guide-scene [data-no-pointer-strike]') ?? document.querySelector('.guide-scene[data-no-pointer-strike]')).not.toBeNull();
  });
});
