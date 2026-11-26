// @vitest-environment happy-dom
// CrescendoStage 렌더 검증: 값만 받는 화면이라 props를 바꿔 가며 상태별 문구·숫자·표시를 읽는다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CrescendoStage } from '@/features/mini/components/crescendo/CrescendoStage';
import type { CrescendoRun } from '@/features/mini/domain/crescendoRound';

afterEach(cleanup);

const progress = (steps: number[]): CrescendoRun => ({ steps, end: null, last: null });
const fell = (steps: number[], last: number): CrescendoRun => ({ steps, end: 'fell', last });
const top = (steps: number[]): CrescendoRun => ({ steps, end: 'top', last: null });

type StageProps = Parameters<typeof CrescendoStage>[0];

function stage(over: Partial<StageProps> = {}) {
  const props: StageProps = {
    phase: 'playing',
    countdown: null,
    run: progress([]),
    wrongPad: false,
    onQuit: () => undefined,
    ...over,
  };
  return render(<CrescendoStage {...props} />);
}

const prompt = () => screen.getByTestId('mini-cres-prompt').textContent;
const count = () => screen.getByTestId('mini-cres-count').textContent;
const last = () => screen.getByTestId('mini-cres-last');

describe('CrescendoStage 머리 문구', () => {
  it('첫 타 전: 「약하게 시작하세요.」, 아래 「약할수록 오를 계단이 많아요.」, 횟수 0, 방금 친 세기 「—」', () => {
    stage();
    expect(prompt()).toBe('약하게 시작하세요.');
    expect(screen.getByText('약할수록 오를 계단이 많아요.')).toBeTruthy();
    expect(count()).toBe('0');
    expect(last().textContent).toBe('—');
    expect(last().className).not.toContain('is-warn');
  });

  it('1계단: 「30보다 세게.」, 아래 「조금만 더 세게 치세요.」, 횟수 1, 방금 친 세기 30', () => {
    stage({ run: progress([30]) });
    expect(prompt()).toBe('30보다 세게.');
    expect(screen.getByText('조금만 더 세게 치세요.')).toBeTruthy();
    expect(screen.queryByText('약할수록 오를 계단이 많아요.')).toBeNull();
    expect(count()).toBe('1');
    expect(last().textContent).toBe('30');
    expect(last().className).not.toContain('is-warn');
  });

  it('3계단: 직전 계단(55)을 머리에 쓰고 횟수 3, 방금 친 세기 55', () => {
    stage({ run: progress([30, 42, 55]) });
    expect(prompt()).toBe('55보다 세게.');
    expect(count()).toBe('3');
    expect(last().textContent).toBe('55');
  });

  it('fell: 「42보다 세지 못했어요.」, 횟수는 계단 수, 방금 친 세기는 끝낸 타격의 값이고 is-warn, 머리 아래 글이 없다', () => {
    stage({ run: fell([30, 42], 42) });
    expect(prompt()).toBe('42보다 세지 못했어요.');
    expect(count()).toBe('2');
    expect(last().textContent).toBe('42');
    expect(last().className).toContain('is-warn');
    expect(screen.queryByText('조금만 더 세게 치세요.')).toBeNull();
    expect(screen.queryByText('약할수록 오를 계단이 많아요.')).toBeNull();
  });

  it('fell에서 끝낸 타격이 직전보다 약하면 그 값(49)을 보인다', () => {
    stage({ run: fell([30, 42, 55], 49) });
    expect(prompt()).toBe('55보다 세지 못했어요.');
    expect(count()).toBe('3');
    expect(last().textContent).toBe('49');
    expect(last().className).toContain('is-warn');
  });

  it('top: 「꼭대기까지 올랐어요.」, 방금 친 세기 127에 is-warn이 없고 머리 아래 글이 없다', () => {
    stage({ run: top([30, 127]) });
    expect(prompt()).toBe('꼭대기까지 올랐어요.');
    expect(count()).toBe('2');
    expect(last().textContent).toBe('127');
    expect(last().className).not.toContain('is-warn');
    expect(screen.queryByText('조금만 더 세게 치세요.')).toBeNull();
  });

  it('마무리(closing)에도 같은 머리 문구를 보인다', () => {
    stage({ phase: 'closing', run: fell([30, 42], 42) });
    expect(prompt()).toBe('42보다 세지 못했어요.');
  });
});

describe('CrescendoStage 높이 값과 끝난 까닭', () => {
  const root = () => screen.getByTestId('mini-cres-stage');
  const heat = () => Number(root().style.getPropertyValue('--cres-heat'));

  it('무대가 mini-stage이자 mini-cres-stage다', () => {
    stage();
    expect(root().className).toContain('mini-stage');
    expect(root().className).toContain('mini-cres-stage');
  });

  it('--cres-heat가 마지막 계단의 눈금 비율이다(계단 없음 0, 64 → 0.5, 127 → 1)', () => {
    const { unmount } = stage();
    expect(heat()).toBe(0);
    unmount();
    const second = stage({ run: progress([30, 64]) });
    expect(heat()).toBeCloseTo(0.5, 5);
    second.unmount();
    stage({ run: top([30, 127]) });
    expect(heat()).toBeCloseTo(1, 5);
  });

  it('떨어진 판의 높이 값은 끝낸 타격이 아니라 마지막 계단이다', () => {
    stage({ run: fell([30, 64], 10) });
    expect(heat()).toBeCloseTo(0.5, 5);
  });

  it('data-end가 진행 중에는 없고 떨어지면 fell, 꼭대기면 top이다', () => {
    const { unmount } = stage({ run: progress([30]) });
    expect(root().hasAttribute('data-end')).toBe(false);
    unmount();
    const second = stage({ run: fell([30, 42], 42) });
    expect(root().getAttribute('data-end')).toBe('fell');
    second.unmount();
    stage({ run: top([30, 127]) });
    expect(root().getAttribute('data-end')).toBe('top');
  });
});

describe('CrescendoStage 숫자의 내려앉음', () => {
  it('첫 타 전에는 is-pop이 없고 세기 숫자가 is-empty다', () => {
    stage();
    expect(screen.getByTestId('mini-cres-count').className).not.toContain('is-pop');
    expect(last().className).not.toContain('is-pop');
    expect(last().className).toContain('is-empty');
  });

  it('계단이 있으면 두 숫자가 is-pop이고 세기 숫자에 is-empty가 없다', () => {
    stage({ run: progress([30]) });
    expect(screen.getByTestId('mini-cres-count').className).toContain('is-pop');
    expect(last().className).toContain('is-pop');
    expect(last().className).not.toContain('is-empty');
  });

  it('계단 수가 바뀌면 두 숫자가 새 요소가 되고, 같으면 그대로다', () => {
    const props = { phase: 'playing' as const, countdown: null, wrongPad: false, onQuit: () => undefined };
    const { rerender } = render(<CrescendoStage {...props} run={progress([30])} />);
    const countEl = screen.getByTestId('mini-cres-count');
    const lastEl = last();
    rerender(<CrescendoStage {...props} run={progress([30])} wrongPad />);
    expect(screen.getByTestId('mini-cres-count')).toBe(countEl);
    expect(last()).toBe(lastEl);
    rerender(<CrescendoStage {...props} run={progress([30, 42])} />);
    expect(screen.getByTestId('mini-cres-count')).not.toBe(countEl);
    expect(last()).not.toBe(lastEl);
  });
});

describe('CrescendoStage 빛줄기와 머리 줄', () => {
  it('플레이·마무리에서 빛줄기가 켜지고 카운트다운 동안은 꺼져 있다', () => {
    const { unmount } = stage({ phase: 'countdown', countdown: 3 });
    expect(document.querySelector('.free-lights')?.className).not.toContain('is-on');
    unmount();
    const second = stage();
    expect(document.querySelector('.free-lights')?.className).toContain('is-on');
    second.unmount();
    stage({ phase: 'closing', run: fell([30, 42], 42) });
    expect(document.querySelector('.free-lights')?.className).toContain('is-on');
  });

  it('머리 줄 보조 글이 「스네어 · 같거나 약하면 끝」이다', () => {
    stage();
    expect(screen.getByTestId('mini-cres-meta').textContent).toBe('스네어 · 같거나 약하면 끝');
  });
});

describe('CrescendoStage 다른 패드 안내', () => {
  it('wrongPad면 머리 아래가 「스네어를 쳐 주세요」(role=status)이고 원래 글은 없다', () => {
    stage({ run: progress([30]), wrongPad: true });
    const hint = screen.getByText('스네어를 쳐 주세요');
    expect(hint.getAttribute('role')).toBe('status');
    expect(hint.className).toContain('is-hint');
    expect(screen.queryByText('조금만 더 세게 치세요.')).toBeNull();
  });

  it('첫 타 전에도 wrongPad면 안내가 원래 글을 대신한다', () => {
    stage({ wrongPad: true });
    expect(screen.getByText('스네어를 쳐 주세요')).toBeTruthy();
    expect(screen.queryByText('약할수록 오를 계단이 많아요.')).toBeNull();
  });

  it('wrongPad가 아니면 안내가 없고 머리 아래 글에는 role이 없다', () => {
    stage({ run: progress([30]) });
    expect(screen.queryByText('스네어를 쳐 주세요')).toBeNull();
    expect(screen.getByText('조금만 더 세게 치세요.').getAttribute('role')).toBeNull();
  });
});

describe('CrescendoStage 카운트다운·조작', () => {
  it('카운트다운(2)에는 숫자 오버레이가 2이고 머리는 첫 타 전 문구다', () => {
    stage({ phase: 'countdown', countdown: 2 });
    expect(document.querySelector('.play-countdown-value')?.textContent).toBe('2');
    expect(prompt()).toBe('약하게 시작하세요.');
  });

  it('카운트다운은 본문이 아니라 무대 바로 아래 요소다(무대 한가운데에 놓인다)', () => {
    stage({ phase: 'countdown', countdown: 3 });
    const value = document.querySelector('.play-countdown-value');
    expect(value).not.toBeNull();
    expect(document.querySelector('.mini-stage-body')?.contains(value)).toBe(false);
    const root = screen.getByTestId('mini-cres-stage');
    expect(Array.from(root.children).some((el) => el.contains(value))).toBe(true);
  });

  it('카운트다운이 아니면 오버레이가 없다', () => {
    stage();
    expect(document.querySelector('.play-countdown-value')).toBeNull();
  });

  it('게임 이름 제목과 「지금까지」·「방금 친 세기」 이름표가 보인다', () => {
    stage();
    expect(screen.getByRole('heading', { name: '어디까지 올라가는 거예요?' })).toBeTruthy();
    expect(screen.getByText('지금까지')).toBeTruthy();
    expect(screen.getByText('방금 친 세기')).toBeTruthy();
  });

  it('세로 눈금이 함께 그려진다', () => {
    stage({ run: progress([30, 42]) });
    expect(screen.getByTestId('mini-cres-ladder')).toBeTruthy();
    expect(screen.getAllByTestId(/^mini-cres-step-/)).toHaveLength(2);
  });

  it('[그만하기]를 누르면 onQuit이 불린다', () => {
    const onQuit = vi.fn();
    stage({ onQuit });
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
