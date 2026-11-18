// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react';
import { PlayHud } from './PlayHud';

afterEach(cleanup);
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

const base = { title: '곡', level: 'NORMAL' as const, elapsedMs: 0, durationMs: 1000 };
const hud = (combo: number, score = 0) => (
  <LazyMotion features={domMax} strict>
    <PlayHud variant="game" {...base} score={score} combo={combo} accuracy={null} />
  </LazyMotion>
);
const combo = (c: HTMLElement) => c.querySelector('[data-stat="combo"]') as HTMLElement;

describe('콤보 범프(E5)', () => {
  it('처음에는 범프가 없다', () => {
    const { container } = render(hud(5));
    expect(combo(container).getAttribute('data-bump')).toBeNull();
  });

  it('값이 오르면 범프가 걸리고 연속 상승마다 다시 걸린다', () => {
    const { container, rerender } = render(hud(5));
    rerender(hud(6));
    expect(combo(container).getAttribute('data-bump')).toBe('1');
    rerender(hud(7));
    expect(combo(container).getAttribute('data-bump')).toBe('2');
  });

  it('같은 값 재렌더(다른 수치 변화)는 범프가 아니다', () => {
    const { container, rerender } = render(hud(5));
    rerender(hud(5, 100));
    expect(combo(container).getAttribute('data-bump')).toBeNull();
  });

  it('감소·0으로 떨어질 때는 범프가 걸리지 않는다', () => {
    const { container, rerender } = render(hud(8));
    rerender(hud(3));
    expect(combo(container).getAttribute('data-bump')).toBeNull();
    rerender(hud(0));
    expect(combo(container).getAttribute('data-bump')).toBeNull();
    expect(combo(container).className).not.toContain('combo-flash');
  });

  it('10의 배수로 오르면 강조 클래스, 다음 값에서는 빠진다', () => {
    const { container, rerender } = render(hud(9));
    rerender(hud(10));
    expect(combo(container).className).toContain('combo-flash');
    rerender(hud(11));
    expect(combo(container).className).not.toContain('combo-flash');
  });

  it('10의 배수로 내려갈 때는 강조하지 않는다', () => {
    const { container, rerender } = render(hud(11));
    rerender(hud(10));
    expect(combo(container).className).not.toContain('combo-flash');
  });

  it('콤보 외 칸은 범프 속성이 없다', () => {
    const { container, rerender } = render(hud(1));
    rerender(hud(2, 500));
    expect(container.querySelector('[data-stat="score"]')?.getAttribute('data-bump')).toBeNull();
  });
});

describe('점수 카운트업(ScoreValue)', () => {
  const score = (c: HTMLElement) => (c.querySelector('[data-stat="score"]') as HTMLElement).textContent;

  it('처음에는 점수 그대로(콤마)', () => {
    const { container } = render(hud(0, 1234));
    expect(score(container)).toBe('1,234');
  });

  it('보간 중 React 렌더가 늘지 않고(점수 변화 1회 = 렌더 1회) 끝에는 새 값', async () => {
    MotionGlobalConfig.skipAnimations = false;
    let commits = 0;
    const tree = (s: number) => (
      <Profiler id="hud" onRender={() => commits++}>
        {hud(0, s)}
      </Profiler>
    );
    const { container, rerender } = render(tree(0));
    const afterMount = commits;
    rerender(tree(900));
    expect(commits).toBe(afterMount + 1);
    // 보간 시작 직후에는 아직 새 값이 아니다(0 ≤ 표시 < 900 또는 즉시 끝난 환경이면 900)
    await new Promise((r) => setTimeout(r, 450));
    expect(score(container)).toBe('900');
    // 보간이 도는 동안 React 렌더는 더 일어나지 않았다
    expect(commits).toBe(afterMount + 1);
  });

  it('점수가 내려가면(처음부터 다시) 보간 없이 바로', () => {
    const { container, rerender } = render(hud(0, 800));
    rerender(hud(0, 0));
    expect(score(container)).toBe('0');
  });
});
