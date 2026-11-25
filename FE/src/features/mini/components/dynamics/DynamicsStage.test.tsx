// @vitest-environment happy-dom
// DynamicsStage·VelocityGauge 렌더 검증: 값만 받는 화면이라 props를 바꿔 가며 단계별 문구·눈금 상태·표시를 읽는다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DynamicsStage } from '@/features/mini/components/dynamics/DynamicsStage';
import type { FeelShot, MatchShot } from '@/features/mini/domain/dynamicsRound';
import { velocityRatio } from '@/features/mini/domain/velocityShot';

const FEEL: FeelShot[] = [
  { level: 'weak', actual: 42 },
  { level: 'mid', actual: 78 },
  { level: 'strong', actual: 109 },
];
const TARGETS = [88, 52, 100];

/** 목표에 실제 값을 붙인 한 타 */
const match = (i: number, actual: number): MatchShot => ({ target: TARGETS[i], actual, diff: actual - TARGETS[i] });

afterEach(cleanup);

type StageProps = Parameters<typeof DynamicsStage>[0];

function stage(over: Partial<StageProps> = {}) {
  const props: StageProps = {
    phase: 'playing',
    countdown: null,
    step: 'feel',
    feel: [],
    targets: [],
    shots: [],
    wrongPad: false,
    onQuit: () => undefined,
    ...over,
  };
  return render(<DynamicsStage {...props} />);
}

/** 숫자 맞추기 화면 */
const matching = (over: Partial<StageProps> = {}) => stage({ step: 'match', feel: FEEL, targets: TARGETS, ...over });

const gauge = (i: number) => screen.getByTestId(`mini-dyn-gauge-${i}`);
const states = () => [0, 1, 2].map((i) => gauge(i).getAttribute('data-state'));
const head = (i: number) => gauge(i).querySelector('.mini-dyn-gauge-head')?.textContent;
const status = (i: number) => gauge(i).querySelector('.mini-dyn-gauge-status');
const prompt = () => screen.getByTestId('mini-dyn-prompt').textContent;
const pct = (value: string | undefined) => Number.parseFloat(value ?? '');

describe('DynamicsStage 감 잡기', () => {
  it('아무것도 안 쳤으면 머리 「약하게 한 번.」, 아래 글, 약·중·강 눈금이고 첫 번째가 current다', () => {
    stage();
    expect(prompt()).toBe('약하게 한 번.');
    expect(screen.getByText('점수는 없어요. 내 세기를 먼저 재요.')).toBeTruthy();
    expect(states()).toEqual(['current', 'next', 'next']);
    expect([head(0), head(1), head(2)]).toEqual(['약', '중', '강']);
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-target-0')).toBeNull();
  });

  it('한 타를 치면 머리 「중간으로 한 번.」, 친 눈금은 done이고 친 값만 나온다', () => {
    stage({ feel: [FEEL[0]] });
    expect(prompt()).toBe('중간으로 한 번.');
    expect(states()).toEqual(['done', 'current', 'next']);
    expect(screen.getByTestId('mini-dyn-actual-0').textContent).toBe('42');
    // 목표·차이 문구는 없다
    expect(gauge(0).textContent).not.toContain('목표');
    expect(screen.getByText('점수는 없어요. 내 세기를 먼저 재요.')).toBeTruthy();
  });

  it('두 타를 치면 머리 「강하게 한 번.」, 세 번째가 current다', () => {
    stage({ feel: [FEEL[0], FEEL[1]] });
    expect(prompt()).toBe('강하게 한 번.');
    expect(states()).toEqual(['done', 'done', 'current']);
    expect(screen.getByTestId('mini-dyn-actual-1').textContent).toBe('78');
  });

  it('친 눈금에만 내 타격 표시가 있고 위치가 친 세기의 비율이다', () => {
    stage({ feel: [FEEL[0]] });
    const marker = gauge(0).querySelector<HTMLElement>('.mini-dyn-marker');
    expect(pct(marker?.style.bottom)).toBeCloseTo(velocityRatio(42) * 100, 5);
    expect(gauge(1).querySelector('.mini-dyn-marker')).toBeNull();
    expect(gauge(2).querySelector('.mini-dyn-marker')).toBeNull();
    // 감 잡기에는 목표 선도 내 세기 표시도 없다
    expect(document.querySelector('.mini-dyn-target-line')).toBeNull();
    expect(document.querySelector('.mini-dyn-mark')).toBeNull();
  });
});

describe('DynamicsStage 내 세기 보이기', () => {
  it('세 값이 모두 done이고 머리 「내 세기를 쟀어요.」, 아래 「이제 숫자에 맞춰 칩니다.」이며 current가 없다', () => {
    stage({ step: 'review', feel: FEEL });
    expect(prompt()).toBe('내 세기를 쟀어요.');
    expect(screen.getByText('이제 숫자에 맞춰 칩니다.')).toBeTruthy();
    expect(states()).toEqual(['done', 'done', 'done']);
    expect([0, 1, 2].map((i) => screen.getByTestId(`mini-dyn-actual-${i}`).textContent)).toEqual(['42', '78', '109']);
    expect(screen.queryByText('지금 칠 차례')).toBeNull();
    expect(screen.queryByTestId('mini-dyn-feel')).toBeNull();
  });

  it('다른 패드 안내(wrongPad)는 나오지 않는다', () => {
    stage({ step: 'review', feel: FEEL, wrongPad: true });
    expect(screen.queryByText('스네어를 쳐 주세요')).toBeNull();
    expect(document.querySelector('.is-hint')).toBeNull();
  });
});

describe('DynamicsStage 숫자 맞추기', () => {
  it('아무것도 안 쳤으면 내 세기 줄, 1타·2타·3타 눈금과 목표 숫자, 머리 「88에 맞춰 한 번.」이 보인다', () => {
    matching();
    const feel = screen.getByTestId('mini-dyn-feel');
    expect(Array.from(feel.querySelectorAll('.mini-dyn-feel-item')).map((el) => el.textContent)).toEqual(['약 42', '중 78', '강 109']);
    expect(states()).toEqual(['current', 'next', 'next']);
    expect([head(0), head(1), head(2)]).toEqual(['1타88', '2타52', '3타100']);
    expect([0, 1, 2].map((i) => screen.getByTestId(`mini-dyn-target-${i}`).textContent)).toEqual(['88', '52', '100']);
    expect(prompt()).toBe('88에 맞춰 한 번.');
    expect(screen.getByText('내 세기를 보고 힘을 가늠하세요.')).toBeTruthy();
    expect(screen.queryByTestId('mini-dyn-actual-0')).toBeNull();
  });

  it('한 타를 치면 친 값·「목표 N」·차이 문구가 나오고 머리가 다음 숫자로 바뀐다', () => {
    matching({ shots: [match(0, 82)] });
    expect(states()).toEqual(['done', 'current', 'next']);
    expect(screen.getByTestId('mini-dyn-actual-0').textContent).toBe('82');
    expect(gauge(0).textContent).toContain('목표 88');
    expect(gauge(0).textContent).toContain('6 약했어요');
    expect(prompt()).toBe('52에 맞춰 한 번.');
    expect(status(1)?.textContent).toBe('지금 칠 차례');
    expect(status(2)?.textContent).toBe('다음');
  });

  it('두 타를 치면 머리가 세 번째 숫자다. 센 타는 「셌어요」, 맞은 타는 「딱 맞았어요」', () => {
    matching({ shots: [match(0, 88), match(1, 61)] });
    expect(states()).toEqual(['done', 'done', 'current']);
    expect(prompt()).toBe('100에 맞춰 한 번.');
    expect(gauge(0).textContent).toContain('딱 맞았어요');
    expect(gauge(1).textContent).toContain('9 셌어요');
  });

  it('세 타를 다 치면 current가 없고 머리 「세 번 다 쳤어요.」, 아래 글이 없다', () => {
    matching({ shots: [match(0, 82), match(1, 61), match(2, 100)] });
    expect(states()).toEqual(['done', 'done', 'done']);
    expect(prompt()).toBe('세 번 다 쳤어요.');
    expect(screen.queryByText('내 세기를 보고 힘을 가늠하세요.')).toBeNull();
    expect(screen.queryByText('지금 칠 차례')).toBeNull();
  });

  it('마무리(closing)에는 두 개만 친 상태여도 current가 없고 「세 번 다 쳤어요.」다', () => {
    matching({ phase: 'closing', shots: [match(0, 82), match(1, 61)] });
    expect(states()).toEqual(['done', 'done', 'next']);
    expect(prompt()).toBe('세 번 다 쳤어요.');
  });

  it('눈금마다 목표 선이 있고 위치가 목표의 비율이다', () => {
    matching();
    TARGETS.forEach((target, i) => {
      const line = gauge(i).querySelector<HTMLElement>('.mini-dyn-target-line');
      expect(pct(line?.style.bottom)).toBeCloseTo(velocityRatio(target) * 100, 5);
    });
  });

  it('눈금마다 내 세기 표시 셋이 있고 글자와 위치가 내 세기를 따른다', () => {
    matching();
    const marks = Array.from(gauge(0).querySelectorAll<HTMLElement>('.mini-dyn-mark'));
    expect(marks.map((mark) => mark.querySelector('.mini-dyn-mark-text')?.textContent)).toEqual(['약', '중', '강']);
    expect(marks.map((mark) => pct(mark.style.bottom))).toEqual(FEEL.map((f) => velocityRatio(f.actual) * 100));
  });

  it('친 눈금에만 내 타격 표시가 있고 위치가 친 세기의 비율이다', () => {
    matching({ shots: [match(0, 82)] });
    const marker = gauge(0).querySelector<HTMLElement>('.mini-dyn-marker');
    expect(pct(marker?.style.bottom)).toBeCloseTo(velocityRatio(82) * 100, 5);
    expect(gauge(1).querySelector('.mini-dyn-marker')).toBeNull();
  });
});

describe('DynamicsStage 다른 패드 안내', () => {
  it('감 잡기에서 wrongPad면 지금 차례 눈금에만 「스네어를 쳐 주세요」가 is-hint로 보인다', () => {
    stage({ feel: [FEEL[0]], wrongPad: true });
    expect(status(1)?.textContent).toBe('스네어를 쳐 주세요');
    expect(status(1)?.className).toContain('is-hint');
    expect(document.querySelectorAll('.is-hint')).toHaveLength(1);
    expect(gauge(0).textContent).not.toContain('스네어를 쳐 주세요');
    expect(gauge(2).textContent).not.toContain('스네어를 쳐 주세요');
  });

  it('숫자 맞추기에서도 지금 차례 눈금에만 보인다', () => {
    matching({ shots: [match(0, 82)], wrongPad: true });
    expect(status(1)?.textContent).toBe('스네어를 쳐 주세요');
    expect(status(1)?.className).toContain('is-hint');
    expect(document.querySelectorAll('.is-hint')).toHaveLength(1);
  });

  it('wrongPad가 아니면 안내가 없다', () => {
    stage();
    expect(screen.queryByText('스네어를 쳐 주세요')).toBeNull();
  });
});

describe('DynamicsStage 카운트다운·조작', () => {
  it('카운트다운(2)에는 숫자 오버레이가 2이고 감 잡기 첫 번째가 current다', () => {
    stage({ phase: 'countdown', countdown: 2 });
    expect(document.querySelector('.play-countdown-value')?.textContent).toBe('2');
    expect(states()).toEqual(['current', 'next', 'next']);
    expect(prompt()).toBe('약하게 한 번.');
  });

  it('카운트다운이 아니면 오버레이가 없다', () => {
    stage();
    expect(document.querySelector('.play-countdown-value')).toBeNull();
  });

  it('눈금 양 끝 글자 127과 1이 보인다', () => {
    stage();
    expect(gauge(0).querySelector('.mini-dyn-tick.is-max')?.textContent).toBe('127');
    expect(gauge(0).querySelector('.mini-dyn-tick.is-min')?.textContent).toBe('1');
  });

  it('[그만하기]를 누르면 onQuit이 불린다', () => {
    const onQuit = vi.fn();
    stage({ onQuit });
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
