// @vitest-environment happy-dom
// SightResult 검증: 문제별 행(번호·패드·시간·속도 단계)과 막대 두 부분의 너비·시간 초과·범례.
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

  it('행의 속도 단계는 answerGrade와 같고 막대는 순번(--i)을 가진 층 안에 있다', () => {
    // 400 · 450 · 500 · (틀림) · 600은 fast, 650 · 700 · 750 · 850은 good, 8번은 느림
    const list = answers({ 3: { ms: 1050, wrongs: 1 }, 8: { ms: 1400 } });
    render(<SightResult answers={list} />);
    const grades = list.map((_, i) => row(i).getAttribute('data-grade'));
    expect(grades).toEqual(['fast', 'fast', 'fast', 'bad', 'fast', 'good', 'good', 'good', 'slow', 'good']);
    const fill = row(4).querySelector('.mini-sight-row-bar > .mini-sight-row-fill') as HTMLElement | null;
    expect(fill?.style.getPropertyValue('--i')).toBe('4');
    expect(fill?.querySelector('.mini-sight-bar-base')).toBeTruthy();
  });

  it('범례 네 칸이 속도 단계와 경계 값을 보인다', () => {
    render(<SightResult answers={answers()} />);
    const items = Array.from(document.querySelectorAll('.mini-sight-legend-item'));
    expect(items.map((el) => el.getAttribute('data-grade'))).toEqual(['fast', 'good', 'slow', 'bad']);
    expect(items.map((el) => el.textContent)).toEqual(['빠름 0.60초 이하', '보통 1.00초 이하', '느림', '틀려서 더해진 0.5초']);
  });
});
