// @vitest-environment happy-dom
// StepLadder 렌더 검증: 값만 받는 세로 눈금이라 판(CrescendoRun)을 직접 넣어 계단 선·채움·울림·오른 만큼·끝낸 타격 선의 개수와 위치를 읽는다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StepLadder } from '@/features/mini/components/crescendo/StepLadder';
import type { CrescendoRun } from '@/features/mini/domain/crescendoRound';
import { velocityRatio } from '@/features/mini/domain/velocityShot';

afterEach(cleanup);

const progress = (steps: number[]): CrescendoRun => ({ steps, end: null, last: null });
const fell = (steps: number[], last: number): CrescendoRun => ({ steps, end: 'fell', last });
const top = (steps: number[]): CrescendoRun => ({ steps, end: 'top', last: null });

const lines = () => screen.queryAllByTestId(/^mini-cres-step-/);
const pct = (value: string | undefined) => Number.parseFloat(value ?? '');

describe('StepLadder 계단 선', () => {
  it('계단이 없으면 선도 채움도 울림도 오른 만큼도 끝낸 타격 선도 없다', () => {
    render(<StepLadder run={progress([])} />);
    expect(screen.getByTestId('mini-cres-ladder')).toBeTruthy();
    expect(lines()).toHaveLength(0);
    expect(screen.queryByTestId('mini-cres-fill')).toBeNull();
    expect(screen.queryByTestId('mini-cres-pulse')).toBeNull();
    expect(screen.queryByTestId('mini-cres-gain')).toBeNull();
    expect(screen.queryByTestId('mini-cres-fall')).toBeNull();
    expect(document.querySelector('.mini-cres-floor')).toBeNull();
  });

  it('계단 수만큼 선이 있고 bottom이 세기의 눈금 비율이다(64 → 50%)', () => {
    render(<StepLadder run={progress([64])} />);
    expect(lines()).toHaveLength(1);
    expect(pct(screen.getByTestId('mini-cres-step-0').style.bottom)).toBeCloseTo(50, 5);
    expect(pct(screen.getByTestId('mini-cres-step-0').style.bottom)).toBeCloseTo(velocityRatio(64) * 100, 5);
  });

  it('세 계단이면 선 셋이 각자 세기의 비율에 있고 마지막 선만 is-top이다', () => {
    render(<StepLadder run={progress([30, 42, 55])} />);
    expect(lines()).toHaveLength(3);
    [30, 42, 55].forEach((value, i) => {
      expect(pct(screen.getByTestId(`mini-cres-step-${i}`).style.bottom)).toBeCloseTo(velocityRatio(value) * 100, 5);
    });
    expect(screen.getByTestId('mini-cres-step-0').className).not.toContain('is-top');
    expect(screen.getByTestId('mini-cres-step-1').className).not.toContain('is-top');
    expect(screen.getByTestId('mini-cres-step-2').className).toContain('is-top');
    expect(document.querySelectorAll('.is-top')).toHaveLength(1);
  });

  it('계단이 하나뿐이면 그 선이 is-top이다', () => {
    render(<StepLadder run={progress([30])} />);
    expect(screen.getByTestId('mini-cres-step-0').className).toContain('is-top');
  });
});

describe('StepLadder 채움', () => {
  it('진행 중이면 있고 높이가 마지막 계단과 맞다', () => {
    render(<StepLadder run={progress([30, 42, 55])} />);
    expect(pct(screen.getByTestId('mini-cres-fill').style.height)).toBeCloseTo(velocityRatio(55) * 100, 5);
  });

  it('계단이 하나여도 그 계단까지 차 있다(64 → 50%)', () => {
    render(<StepLadder run={progress([64])} />);
    expect(pct(screen.getByTestId('mini-cres-fill').style.height)).toBeCloseTo(50, 5);
  });

  it('끝난 판(fell·top)에도 마지막 계단까지 차 있다', () => {
    const { unmount } = render(<StepLadder run={fell([30, 42], 12)} />);
    expect(pct(screen.getByTestId('mini-cres-fill').style.height)).toBeCloseTo(velocityRatio(42) * 100, 5);
    unmount();
    render(<StepLadder run={top([30, 127])} />);
    expect(pct(screen.getByTestId('mini-cres-fill').style.height)).toBeCloseTo(100, 5);
  });

  it('「아래 어두운 영역」은 어느 판에도 없다', () => {
    render(<StepLadder run={progress([30, 42])} />);
    expect(document.querySelector('.mini-cres-floor')).toBeNull();
  });
});

describe('StepLadder 울림', () => {
  it('계단이 하나 이상이면 맨 위 선의 높이에 있다', () => {
    render(<StepLadder run={progress([30, 64])} />);
    const pulse = screen.getByTestId('mini-cres-pulse');
    expect(pct(pulse.style.bottom)).toBeCloseTo(50, 5);
    expect(pulse.className).not.toContain('is-top');
  });

  it('계단 수가 바뀌면 새 요소가 되고, 같으면 그대로다', () => {
    const { rerender } = render(<StepLadder run={progress([30])} />);
    const first = screen.getByTestId('mini-cres-pulse');
    rerender(<StepLadder run={progress([30])} />);
    expect(screen.getByTestId('mini-cres-pulse')).toBe(first);
    rerender(<StepLadder run={progress([30, 42])} />);
    expect(screen.getByTestId('mini-cres-pulse')).not.toBe(first);
  });

  it('꼭대기로 끝났으면 is-top이다', () => {
    render(<StepLadder run={top([30, 127])} />);
    const pulse = screen.getByTestId('mini-cres-pulse');
    expect(pulse.className).toContain('is-top');
    expect(pct(pulse.style.bottom)).toBeCloseTo(100, 5);
  });

  it('떨어진 판에는 없다', () => {
    render(<StepLadder run={fell([30, 42], 12)} />);
    expect(screen.queryByTestId('mini-cres-pulse')).toBeNull();
  });
});

describe('StepLadder 오른 만큼', () => {
  it('계단이 하나뿐이면 없다', () => {
    render(<StepLadder run={progress([30])} />);
    expect(screen.queryByTestId('mini-cres-gain')).toBeNull();
  });

  it('둘 이상이면 「+(마지막 계단 − 그 앞 계단)」이고 맨 위 선의 높이에 있다', () => {
    render(<StepLadder run={progress([30, 42, 55])} />);
    const gain = screen.getByTestId('mini-cres-gain');
    expect(gain.textContent).toBe('+13');
    expect(pct(gain.style.bottom)).toBeCloseTo(velocityRatio(55) * 100, 5);
  });

  it('계단을 오르면 새 요소가 되고 값이 바뀐다', () => {
    const { rerender } = render(<StepLadder run={progress([30, 42])} />);
    const first = screen.getByTestId('mini-cres-gain');
    expect(first.textContent).toBe('+12');
    rerender(<StepLadder run={progress([30, 42, 43])} />);
    expect(screen.getByTestId('mini-cres-gain')).not.toBe(first);
    expect(screen.getByTestId('mini-cres-gain').textContent).toBe('+1');
  });

  it('끝난 판에도 마지막으로 오른 만큼이 남는다', () => {
    render(<StepLadder run={fell([30, 42], 12)} />);
    expect(screen.getByTestId('mini-cres-gain').textContent).toBe('+12');
  });
});

describe('StepLadder 끝낸 타격 선', () => {
  it('fell일 때만 있고 bottom이 끝낸 타격의 비율이다', () => {
    render(<StepLadder run={fell([30, 42, 55], 49)} />);
    const line = screen.getByTestId('mini-cres-fall');
    expect(pct(line.style.bottom)).toBeCloseTo(velocityRatio(49) * 100, 5);
    expect(lines()).toHaveLength(3);
  });

  it('진행 중·top에는 없다', () => {
    const { unmount } = render(<StepLadder run={progress([30, 42])} />);
    expect(screen.queryByTestId('mini-cres-fall')).toBeNull();
    unmount();
    render(<StepLadder run={top([30, 127])} />);
    expect(screen.queryByTestId('mini-cres-fall')).toBeNull();
  });
});

describe('StepLadder 눈금 숫자', () => {
  it('위 127, 아래 1이 보인다', () => {
    render(<StepLadder run={progress([])} />);
    expect(document.querySelector('.mini-cres-tick.is-max')?.textContent).toBe('127');
    expect(document.querySelector('.mini-cres-tick.is-min')?.textContent).toBe('1');
  });
});
