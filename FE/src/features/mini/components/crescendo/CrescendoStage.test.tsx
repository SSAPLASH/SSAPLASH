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
