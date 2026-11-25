// @vitest-environment happy-dom
// SightResult 검증: 문제별 행(번호·패드·시간)과 막대 두 부분의 너비·시간 초과·설명 줄.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { SightResult } from '@/features/mini/components/sight/SightResult';
import { barParts, barScaleMs, type SightAnswer } from '@/features/mini/domain/sightRound';

afterEach(cleanup);

const PADS: PadId[] = ['SNARE', 'HIHAT', 'CRASH', 'RIDE', 'KICK', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'SNARE', 'KICK'];

function answers(over: Partial<Record<number, Partial<SightAnswer>>> = {}): SightAnswer[] {
  return PADS.map((pad, i) => ({ pad, ms: 400 + i * 50, wrongs: 0, timedOut: false, ...over[i] }));
}

const row = (i: number) => screen.getByTestId(`mini-sight-row-${i}`);
const width = (el: Element | null) => (el as HTMLElement | null)?.style.width ?? null;
const NOTE = '빨간 부분은 틀려서 더해진 0.5초예요.';

describe('SightResult', () => {
  it('제목과 열 행이 낸 순서대로 번호·패드 이름·시간을 보인다', () => {
    const list = answers();
    render(<SightResult answers={list} />);
    expect(screen.getByRole('heading', { name: '문제별 반응 시간' })).toBeTruthy();
    expect(document.querySelectorAll('.mini-sight-row')).toHaveLength(10);
    list.forEach((answer, i) => {
      expect(row(i).querySelector('.mini-sight-row-no')?.textContent).toBe(String(i + 1));
      expect(row(i).querySelector('.mini-sight-row-pad')?.textContent).toBe(PAD_META[answer.pad].label);
      expect(row(i).querySelector('.mini-sight-row-time')?.textContent).toBe(`${(answer.ms / 1000).toFixed(2)}초`);
      expect(row(i).querySelector('.mini-sight-row-time')?.classList.contains('is-bad')).toBe(false);
    });
  });

  it('막대 너비는 barParts(답, barScaleMs(답들))의 비율과 같다', () => {
    const list = answers({ 3: { ms: 1700, wrongs: 1 }, 6: { ms: 900, wrongs: 2 } });
    render(<SightResult answers={list} />);
    const scale = barScaleMs(list);
    list.forEach((answer, i) => {
      const { base, penalty } = barParts(answer, scale);
      expect(width(row(i).querySelector('.mini-sight-bar-base'))).toBe(`${base * 100}%`);
      const penaltyEl = row(i).querySelector('.mini-sight-bar-penalty');
      if (penalty > 0) expect(width(penaltyEl)).toBe(`${penalty * 100}%`);
      else expect(penaltyEl).toBeNull();
    });
  });

  it('벌점 막대는 틀린 행에만 있다', () => {
    render(<SightResult answers={answers({ 2: { ms: 1300, wrongs: 1 } })} />);
    expect(document.querySelectorAll('.mini-sight-bar-penalty')).toHaveLength(1);
    expect(row(2).querySelector('.mini-sight-bar-penalty')).not.toBeNull();
    expect(row(0).querySelector('.mini-sight-bar-penalty')).toBeNull();
  });

  it('시간 초과 행은 「시간 초과」이고 is-bad다', () => {
    render(<SightResult answers={answers({ 4: { ms: 5000, timedOut: true } })} />);
    const time = row(4).querySelector('.mini-sight-row-time');
    expect(time?.textContent).toBe('시간 초과');
    expect(time?.classList.contains('is-bad')).toBe(true);
    expect(row(3).querySelector('.mini-sight-row-time')?.textContent).toBe('0.55초');
  });

  it('틀린 문제가 있을 때만 설명 줄이 나온다', () => {
    render(<SightResult answers={answers()} />);
    expect(screen.queryByText(NOTE)).toBeNull();
    cleanup();
    render(<SightResult answers={answers({ 7: { wrongs: 1, ms: 950 } })} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it('시간 초과만 있고 틀린 타격이 없으면 설명 줄이 없다', () => {
    render(<SightResult answers={answers({ 1: { ms: 5000, timedOut: true } })} />);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
