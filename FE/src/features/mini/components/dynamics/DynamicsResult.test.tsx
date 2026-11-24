// @vitest-environment happy-dom
// DynamicsResult 렌더 검증: 「타격별 세기」 판의 제목·범례·행과 띠·점의 가로 위치.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DynamicsResult } from '@/features/mini/components/dynamics/DynamicsResult';
import { bandRange, toShot, velocityRatio, type DynamicsShot } from '@/features/mini/domain/dynamicsRound';

afterEach(cleanup);

const SHOTS: DynamicsShot[] = [
  toShot({ level: 'weak', velocity: 45 }, 39),
  toShot({ level: 'strong', velocity: 110 }, 119),
  toShot({ level: 'mid', velocity: 75 }, 75),
];

const row = (i: number) => screen.getByTestId(`mini-dyn-row-${i}`);
const pct = (value: string | undefined) => Number.parseFloat(value ?? '');

describe('DynamicsResult', () => {
  it('제목 「타격별 세기」와 범례 글자가 보인다', () => {
    render(<DynamicsResult shots={SHOTS} />);
    expect(screen.getByRole('heading', { name: '타격별 세기' })).toBeTruthy();
    expect(screen.getByText('목표 띠')).toBeTruthy();
    expect(screen.getByText('내 타격')).toBeTruthy();
  });

  it('타마다 한 행이 있고 이름·실제 세기·메모·점수가 보인다', () => {
    render(<DynamicsResult shots={SHOTS} />);
    expect(screen.getAllByTestId(/^mini-dyn-row-/)).toHaveLength(3);
    const text = (i: number, cls: string) => row(i).querySelector(cls)?.textContent;
    expect(text(0, '.mini-dyn-row-label')).toBe('1타 · 약');
    expect(text(1, '.mini-dyn-row-label')).toBe('2타 · 강');
    expect(text(2, '.mini-dyn-row-label')).toBe('3타 · 중');
    expect(text(0, '.mini-dyn-row-actual')).toBe('39');
    expect(text(1, '.mini-dyn-row-actual')).toBe('119');
    expect(text(0, '.mini-dyn-row-meta')).toBe('목표 45 · 6 약함');
    expect(text(1, '.mini-dyn-row-meta')).toBe('목표 110 · 9 셈');
    expect(text(2, '.mini-dyn-row-meta')).toBe('목표 75 · 딱 맞음');
    expect(text(0, '.mini-dyn-row-score')).toBe('94점');
    expect(text(1, '.mini-dyn-row-score')).toBe('91점');
    expect(text(2, '.mini-dyn-row-score')).toBe('100점');
  });

  it('띠의 left·width와 점의 left가 눈금 비율의 백분율이다', () => {
    render(<DynamicsResult shots={SHOTS} />);
    SHOTS.forEach((shot, i) => {
      const { low, high } = bandRange(shot.target);
      const band = row(i).querySelector<HTMLElement>('.mini-dyn-row-band');
      const dot = row(i).querySelector<HTMLElement>('.mini-dyn-row-dot');
      expect(pct(band?.style.left)).toBeCloseTo(velocityRatio(low) * 100, 5);
      expect(pct(band?.style.width)).toBeCloseTo((velocityRatio(high) - velocityRatio(low)) * 100, 5);
      expect(pct(dot?.style.left)).toBeCloseTo(velocityRatio(shot.actual) * 100, 5);
    });
  });

  it('highlight를 주면 그 행의 메모에만 is-warn이 붙는다', () => {
    render(<DynamicsResult shots={SHOTS} highlight={1} />);
    expect(row(0).querySelector('.mini-dyn-row-meta')?.className).not.toContain('is-warn');
    expect(row(1).querySelector('.mini-dyn-row-meta')?.className).toContain('is-warn');
    expect(row(2).querySelector('.mini-dyn-row-meta')?.className).not.toContain('is-warn');
    expect(document.querySelectorAll('.is-warn')).toHaveLength(1);
  });

  it('highlight가 없으면 강조하는 행이 없다', () => {
    render(<DynamicsResult shots={SHOTS} />);
    expect(document.querySelector('.is-warn')).toBeNull();
  });
});
