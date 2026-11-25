// @vitest-environment happy-dom
// CrescendoResult 렌더 검증: 「세기 계단」 판의 제목·칸 3개·막대(개수·차례·값·높이)·끝낸 타격 막대.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CrescendoResult } from '@/features/mini/components/crescendo/CrescendoResult';
import type { CrescendoRun } from '@/features/mini/domain/crescendoRound';
import { velocityRatio } from '@/features/mini/domain/velocityShot';

afterEach(cleanup);

const fell = (steps: number[], last: number): CrescendoRun => ({ steps, end: 'fell', last });
const top = (steps: number[]): CrescendoRun => ({ steps, end: 'top', last: null });

const bars = () => screen.getAllByTestId(/^mini-cres-bar-\d+$/);
const pct = (value: string | undefined) => Number.parseFloat(value ?? '');
const fillHeight = (el: HTMLElement) => pct(el.querySelector<HTMLElement>('.mini-cres-bar-fill')?.style.height);

/** 칸 하나의 전체 글자(라벨·값). 없으면 null */
function cell(label: string): string | null {
  for (const dt of Array.from(document.querySelectorAll('.mini-cell-label'))) {
    if (dt.textContent === label) return dt.parentElement?.textContent ?? null;
  }
  return null;
}

describe('CrescendoResult 칸 3개', () => {
  it('시작 세기·끝 세기·평균 간격이 값이다(30·42·55 → 30 · 55 · 12.5)', () => {
    render(<CrescendoResult run={fell([30, 42, 55], 49)} />);
    expect(Array.from(document.querySelectorAll('.mini-cell-label')).map((el) => el.textContent)).toEqual(['시작 세기', '끝 세기', '평균 간격']);
    expect(cell('시작 세기')).toContain('30');
    expect(cell('끝 세기')).toContain('55');
    expect(cell('평균 간격')).toContain('12.5');
  });

  it('끝 세기는 끝낸 타격이 아니라 마지막 계단이다', () => {
    render(<CrescendoResult run={fell([30, 42, 55], 10)} />);
    expect(cell('끝 세기')).toContain('55');
    expect(cell('끝 세기')).not.toContain('10');
  });

  it('계단이 1개면 평균 간격이 「—」다', () => {
    render(<CrescendoResult run={fell([50], 20)} />);
    expect(cell('시작 세기')).toContain('50');
    expect(cell('끝 세기')).toContain('50');
    expect(cell('평균 간격')).toContain('—');
  });
});

describe('CrescendoResult 세기 계단 판', () => {
  it('판 제목이 「세기 계단」이다', () => {
    render(<CrescendoResult run={fell([30, 42], 42)} />);
    expect(screen.getByRole('heading', { name: '세기 계단' })).toBeTruthy();
  });

  it('계단마다 막대가 하나씩 있고 차례(1부터)·값·높이가 맞다', () => {
    render(<CrescendoResult run={fell([30, 42, 55], 49)} />);
    expect(bars()).toHaveLength(3);
    expect(bars().map((el) => el.querySelector('.mini-cres-bar-index')?.textContent)).toEqual(['1', '2', '3']);
    expect(bars().map((el) => el.querySelector('.mini-cres-bar-value')?.textContent)).toEqual(['30', '42', '55']);
    bars().forEach((el, i) => {
      expect(fillHeight(el)).toBeCloseTo(velocityRatio([30, 42, 55][i]) * 100, 5);
    });
  });

  it('막대 높이는 세기의 눈금 비율이다(64 → 50%)', () => {
    render(<CrescendoResult run={top([64, 127])} />);
    expect(fillHeight(bars()[0])).toBeCloseTo(50, 5);
    expect(fillHeight(bars()[1])).toBeCloseTo(100, 5);
  });

  it('마지막 계단 막대만 is-top이다', () => {
    render(<CrescendoResult run={fell([30, 42, 55], 49)} />);
    expect(screen.getByTestId('mini-cres-bar-2').className).toContain('is-top');
    expect(screen.getByTestId('mini-cres-bar-0').className).not.toContain('is-top');
    expect(screen.getByTestId('mini-cres-bar-1').className).not.toContain('is-top');
    // 끝낸 타격 막대는 is-top이 아니다
    expect(screen.getByTestId('mini-cres-bar-fall').className).not.toContain('is-top');
  });

  it('fell이면 끝에 「끝」 막대가 붙고 값과 높이가 끝낸 타격이다', () => {
    render(<CrescendoResult run={fell([30, 42, 55], 49)} />);
    const bar = screen.getByTestId('mini-cres-bar-fall');
    expect(bar.className).toContain('is-fall');
    expect(bar.querySelector('.mini-cres-bar-index')?.textContent).toBe('끝');
    expect(bar.querySelector('.mini-cres-bar-value')?.textContent).toBe('49');
    expect(fillHeight(bar)).toBeCloseTo(velocityRatio(49) * 100, 5);
    // 계단 막대 뒤에 놓인다
    const all = Array.from(document.querySelectorAll('.mini-cres-bar'));
    expect(all[all.length - 1]).toBe(bar);
    expect(all).toHaveLength(4);
  });

  it('top이면 끝낸 타격 막대가 없다', () => {
    render(<CrescendoResult run={top([30, 80, 127])} />);
    expect(bars()).toHaveLength(3);
    expect(screen.queryByTestId('mini-cres-bar-fall')).toBeNull();
    expect(screen.getByTestId('mini-cres-bar-2').className).toContain('is-top');
  });
});
