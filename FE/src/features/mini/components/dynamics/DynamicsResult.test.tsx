// @vitest-environment happy-dom
// DynamicsResult 렌더 검증: 「타격별 세기」 판의 제목·내 세기 줄·범례·행과 목표 선·내 타격 점·내 세기 표시의 가로 위치.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DynamicsResult } from '@/features/mini/components/dynamics/DynamicsResult';
import type { FeelShot, MatchShot } from '@/features/mini/domain/dynamicsRound';
import { velocityRatio } from '@/features/mini/domain/velocityShot';

afterEach(cleanup);

const FEEL: FeelShot[] = [
  { level: 'weak', actual: 42 },
  { level: 'mid', actual: 78 },
  { level: 'strong', actual: 109 },
];

// 차이(실제 − 목표)는 −6·+9·0
const SHOTS: MatchShot[] = [
  { target: 88, actual: 82, diff: -6 },
  { target: 110, actual: 119, diff: 9 },
  { target: 75, actual: 75, diff: 0 },
];

const row = (i: number) => screen.getByTestId(`mini-dyn-row-${i}`);
const pct = (value: string | undefined) => Number.parseFloat(value ?? '');
const text = (i: number, cls: string) => row(i).querySelector(cls)?.textContent;

describe('DynamicsResult', () => {
  it('제목 「타격별 세기」와 범례 글자 셋이 보인다', () => {
    render(<DynamicsResult feel={FEEL} shots={SHOTS} />);
    expect(screen.getByRole('heading', { name: '타격별 세기' })).toBeTruthy();
    const legend = Array.from(document.querySelectorAll('.mini-dyn-legend-item')).map((el) => el.textContent);
    expect(legend).toEqual(['목표', '내 타격', '내 세기']);
  });

  it('판 위에 내 세기 줄이 있고 항목 글이 약·중·강 차례다', () => {
    render(<DynamicsResult feel={FEEL} shots={SHOTS} />);
    expect(screen.getByTestId('mini-dyn-feel')).toBeTruthy();
    const items = Array.from(document.querySelectorAll('.mini-dyn-feel-item')).map((el) => el.textContent);
    expect(items).toEqual(['약 42', '중 78', '강 109']);
  });

  it('타마다 한 행이 있고 이름·친 값·목표와 차이·오차가 보인다', () => {
    render(<DynamicsResult feel={FEEL} shots={SHOTS} />);
    expect(screen.getAllByTestId(/^mini-dyn-row-/)).toHaveLength(3);
    expect([text(0, '.mini-dyn-row-label'), text(1, '.mini-dyn-row-label'), text(2, '.mini-dyn-row-label')]).toEqual(['1타', '2타', '3타']);
    expect([text(0, '.mini-dyn-row-actual'), text(1, '.mini-dyn-row-actual'), text(2, '.mini-dyn-row-actual')]).toEqual(['82', '119', '75']);
    expect([text(0, '.mini-dyn-row-meta'), text(1, '.mini-dyn-row-meta'), text(2, '.mini-dyn-row-meta')]).toEqual([
      '목표 88 · 6 약함',
      '목표 110 · 9 셈',
      '목표 75 · 딱 맞음',
    ]);
    expect([text(0, '.mini-dyn-row-score'), text(1, '.mini-dyn-row-score'), text(2, '.mini-dyn-row-score')]).toEqual([
      '오차 6',
      '오차 9',
      '오차 0',
    ]);
  });

  it('목표 선·내 타격 점·내 세기 표시의 left가 눈금 비율의 백분율이다', () => {
    render(<DynamicsResult feel={FEEL} shots={SHOTS} />);
    SHOTS.forEach((shot, i) => {
      const target = row(i).querySelector<HTMLElement>('.mini-dyn-row-target');
      const dot = row(i).querySelector<HTMLElement>('.mini-dyn-row-dot');
      const marks = Array.from(row(i).querySelectorAll<HTMLElement>('.mini-dyn-row-mark'));
      expect(pct(target?.style.left)).toBeCloseTo(velocityRatio(shot.target) * 100, 5);
      expect(pct(dot?.style.left)).toBeCloseTo(velocityRatio(shot.actual) * 100, 5);
      expect(marks.map((mark) => pct(mark.style.left))).toEqual(FEEL.map((f) => velocityRatio(f.actual) * 100));
    });
  });

  it('행의 data-grade가 차이 5 이하 perfect, 12 이하 near, 그 밖 far다', () => {
    render(
      <DynamicsResult
        feel={FEEL}
        shots={[
          { target: 88, actual: 83, diff: -5 },
          { target: 60, actual: 72, diff: 12 },
          { target: 100, actual: 80, diff: -20 },
        ]}
      />,
    );
    expect([0, 1, 2].map((i) => row(i).getAttribute('data-grade'))).toEqual(['perfect', 'near', 'far']);
  });

  it('타격 점에 행 차례(--i)가 있다', () => {
    render(<DynamicsResult feel={FEEL} shots={SHOTS} />);
    const order = [0, 1, 2].map((i) => row(i).querySelector<HTMLElement>('.mini-dyn-row-dot')?.style.getPropertyValue('--i'));
    expect(order).toEqual(['0', '1', '2']);
  });

  it('눈금 위 자리는 1이 0%, 64가 50%, 127이 100%다', () => {
    render(
      <DynamicsResult
        feel={[{ level: 'weak', actual: 1 }]}
        shots={[{ target: 64, actual: 127, diff: 63 }]}
      />,
    );
    expect(pct(row(0).querySelector<HTMLElement>('.mini-dyn-row-target')?.style.left)).toBeCloseTo(50, 5);
    expect(pct(row(0).querySelector<HTMLElement>('.mini-dyn-row-dot')?.style.left)).toBeCloseTo(100, 5);
    expect(pct(row(0).querySelector<HTMLElement>('.mini-dyn-row-mark')?.style.left)).toBeCloseTo(0, 5);
  });

  it('highlight를 주면 그 행의 메모에만 is-warn이 붙는다', () => {
    render(<DynamicsResult feel={FEEL} shots={SHOTS} highlight={1} />);
    expect(row(0).querySelector('.mini-dyn-row-meta')?.className).not.toContain('is-warn');
    expect(row(1).querySelector('.mini-dyn-row-meta')?.className).toContain('is-warn');
    expect(row(2).querySelector('.mini-dyn-row-meta')?.className).not.toContain('is-warn');
    expect(document.querySelectorAll('.is-warn')).toHaveLength(1);
  });

  it('highlight가 없으면 강조하는 행이 없다', () => {
    render(<DynamicsResult feel={FEEL} shots={SHOTS} />);
    expect(document.querySelector('.is-warn')).toBeNull();
  });
});
