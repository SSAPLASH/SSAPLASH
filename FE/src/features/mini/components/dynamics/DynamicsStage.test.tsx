// @vitest-environment happy-dom
// DynamicsStage·VelocityGauge 렌더 검증: 값만 받는 화면이라 props를 바꿔 가며 눈금 상태·띠·표시를 읽는다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DynamicsStage } from '@/features/mini/components/dynamics/DynamicsStage';
import { bandRange, toShot, velocityRatio, type DynamicsTarget } from '@/features/mini/domain/dynamicsRound';

const TARGETS: DynamicsTarget[] = [
  { level: 'weak', velocity: 45 },
  { level: 'strong', velocity: 110 },
  { level: 'mid', velocity: 75 },
];

afterEach(cleanup);

type StageProps = Parameters<typeof DynamicsStage>[0];

function stage(over: Partial<StageProps> = {}) {
  const props: StageProps = { phase: 'playing', countdown: null, targets: TARGETS, shots: [], wrongPad: false, onQuit: () => undefined, ...over };
  return render(<DynamicsStage {...props} />);
}

const gauge = (i: number) => screen.getByTestId(`mini-dyn-gauge-${i}`);
const states = () => [0, 1, 2].map((i) => gauge(i).getAttribute('data-state'));
const pct = (value: string) => Number.parseFloat(value);

describe('DynamicsStage 눈금 상태', () => {
  it('눈금 세 개를 그리고 친 수만큼 done, 다음이 current, 나머지가 next다', () => {
    stage({ shots: [toShot(TARGETS[0], 40)] });
    expect(screen.getAllByTestId(/^mini-dyn-gauge-/)).toHaveLength(3);
    expect(states()).toEqual(['done', 'current', 'next']);
  });

  it('아무것도 안 쳤으면 첫 번째가 current다', () => {
    stage();
    expect(states()).toEqual(['current', 'next', 'next']);
  });

  it('마무리(closing)에는 current가 없다', () => {
    stage({ phase: 'closing', shots: TARGETS.map((t) => toShot(t, t.velocity)) });
    expect(states()).toEqual(['done', 'done', 'done']);
    expect(screen.getByTestId('mini-dyn-prompt').textContent).toBe('세 번 다 쳤어요.');
  });

  it('마무리에 두 개만 친 상태여도 current가 없다', () => {
    stage({ phase: 'closing', shots: [toShot(TARGETS[0], 45), toShot(TARGETS[1], 110)] });
    expect(states()).toEqual(['done', 'done', 'next']);
  });

  it('카운트다운(2)에는 숫자 오버레이가 2이고 첫 번째가 current다', () => {
    stage({ phase: 'countdown', countdown: 2 });
    expect(document.querySelector('.play-countdown-value')?.textContent).toBe('2');
    expect(states()).toEqual(['current', 'next', 'next']);
  });

  it('카운트다운이 아니면 오버레이가 없다', () => {
    stage();
    expect(document.querySelector('.play-countdown-value')).toBeNull();
  });
});

describe('DynamicsStage 머리 문구', () => {
  it('지금 차례의 단계 문구와 아래 한 줄을 보인다', () => {
    stage();
    expect(screen.getByTestId('mini-dyn-prompt').textContent).toBe('이번엔 약하게.');
    expect(screen.getByText('밝은 띠 안에 들어오게 한 번 치세요.')).toBeTruthy();
  });

  it('목표가 없으면 문구도 눈금도 없고 깨지지 않는다', () => {
    stage({ targets: [] });
    expect(screen.queryAllByTestId(/^mini-dyn-gauge-/)).toHaveLength(0);
    expect(screen.getByTestId('mini-dyn-prompt').textContent).toBe('');
    expect(screen.queryByText('밝은 띠 안에 들어오게 한 번 치세요.')).toBeNull();
  });
});

describe('VelocityGauge 표시', () => {
  it('띠의 아래·높이가 bandRange·velocityRatio에서 나온 백분율이다', () => {
    stage();
    TARGETS.forEach((target, i) => {
      const { low, high } = bandRange(target.velocity);
      const band = gauge(i).querySelector<HTMLElement>('.mini-dyn-band');
      expect(pct(band?.style.bottom ?? '')).toBeCloseTo(velocityRatio(low) * 100, 5);
      expect(pct(band?.style.height ?? '')).toBeCloseTo((velocityRatio(high) - velocityRatio(low)) * 100, 5);
    });
  });

  it('눈금 끝의 목표는 띠가 눈금 밖으로 나가지 않는다(자른다)', () => {
    stage({ targets: [{ level: 'strong', velocity: 126 }, { level: 'weak', velocity: 3 }, { level: 'mid', velocity: 75 }] });
    const top = gauge(0).querySelector<HTMLElement>('.mini-dyn-band');
    expect(pct(top?.style.bottom ?? '') + pct(top?.style.height ?? '')).toBeCloseTo(100, 5);
    const bottom = gauge(1).querySelector<HTMLElement>('.mini-dyn-band');
    expect(pct(bottom?.style.bottom ?? '')).toBeCloseTo(0, 5);
  });

  it('친 눈금에만 표시가 있고 위치가 친 세기의 비율이다', () => {
    stage({ shots: [toShot(TARGETS[0], 39)] });
    const marker = gauge(0).querySelector<HTMLElement>('.mini-dyn-marker');
    expect(pct(marker?.style.bottom ?? '')).toBeCloseTo(velocityRatio(39) * 100, 5);
    expect(gauge(1).querySelector('.mini-dyn-marker')).toBeNull();
    expect(gauge(2).querySelector('.mini-dyn-marker')).toBeNull();
  });

  it('친 눈금은 실제 세기·목표·한 줄 평을, 아직 안 친 눈금은 상태 글자를 보인다', () => {
    stage({ shots: [toShot(TARGETS[0], 39)] });
    expect(screen.getByTestId('mini-dyn-actual-0').textContent).toBe('39');
    expect(gauge(0).textContent).toContain('목표 45');
    expect(gauge(0).textContent).toContain('6 약했어요');
    expect(gauge(1).querySelector('.mini-dyn-gauge-status')?.textContent).toBe('지금 칠 차례');
    expect(gauge(2).querySelector('.mini-dyn-gauge-status')?.textContent).toBe('다음');
  });

  it('눈금 양 끝 글자 127과 1이 보인다', () => {
    stage();
    expect(gauge(0).querySelector('.mini-dyn-tick.is-max')?.textContent).toBe('127');
    expect(gauge(0).querySelector('.mini-dyn-tick.is-min')?.textContent).toBe('1');
  });

  it('다른 패드를 쳤으면(wrongPad) 지금 차례 눈금에만 안내가 is-hint로 보인다', () => {
    stage({ wrongPad: true, shots: [toShot(TARGETS[0], 40)] });
    const hint = gauge(1).querySelector('.mini-dyn-gauge-status');
    expect(hint?.textContent).toBe('스네어를 쳐 주세요');
    expect(hint?.className).toContain('is-hint');
    expect(document.querySelectorAll('.is-hint')).toHaveLength(1);
    expect(gauge(0).textContent).not.toContain('스네어를 쳐 주세요');
    expect(gauge(2).textContent).not.toContain('스네어를 쳐 주세요');
  });

  it('wrongPad가 아니면 안내가 없다', () => {
    stage();
    expect(screen.queryByText('스네어를 쳐 주세요')).toBeNull();
  });
});

describe('DynamicsStage 조작', () => {
  it('[그만하기]를 누르면 onQuit이 불린다', () => {
    const onQuit = vi.fn();
    stage({ onQuit });
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
