// @vitest-environment happy-dom
// TempoStage·CountDots 검증: 값만 받는 화면이라 단계(listen·measure)와 숫자에 따라 보이는 글과 점을 본다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import type { TempoStep } from '@/features/mini/domain/tempoRound';
import { CountDots } from './CountDots';
import { TempoStage } from './TempoStage';

afterEach(cleanup);

function stage(over: { phase?: MiniPhase; countdown?: number | null; bpm?: number; step?: TempoStep; beats?: number; hits?: number; onQuit?: () => void }) {
  return render(
    <TempoStage
      phase={over.phase ?? 'playing'}
      countdown={over.countdown ?? null}
      bpm={over.bpm ?? 96}
      step={over.step ?? 'listen'}
      beats={over.beats ?? 0}
      hits={over.hits ?? 0}
      onQuit={over.onQuit ?? (() => undefined)}
    />,
  );
}

const dots = () => Array.from(document.querySelectorAll('.mini-tempo-dot'));
const dotsOn = () => dots().filter((dot) => dot.getAttribute('data-state') === 'on').length;

describe('TempoStage', () => {
  it('예비 박 단계: 「예비 박」·「박을 들어 보세요」·안내 글·「n / 8」과 여덟 개 점(네 개씩 두 묶음)', () => {
    const { container } = stage({ step: 'listen', beats: 3 });
    expect(screen.getByTestId('mini-tempo-tag').textContent).toBe('예비 박');
    expect(screen.getByTestId('mini-tempo-headline').textContent).toBe('박을 들어 보세요');
    expect(container.querySelector('.mini-tempo-desc')?.textContent).toBe('8박 뒤에 소리가 꺼져요. 그 뒤로 같은 빠르기로 16번 치세요.');
    expect(screen.getByTestId('mini-tempo-count').textContent).toBe('3 / 8');
    expect(dots()).toHaveLength(8);
    expect(dotsOn()).toBe(3);
    const groups = Array.from(container.querySelectorAll('.mini-tempo-dot-group'));
    expect(groups.map((group) => group.querySelectorAll('.mini-tempo-dot').length)).toEqual([4, 4]);
    expect(screen.getByRole('group', { name: '예비 박' })).toBeTruthy();
  });

  it('측정 단계: 「소리 꺼짐」·「같은 빠르기로 치세요」·안내 글·「n / 16」과 열여섯 개 점(네 묶음)', () => {
    const { container } = stage({ step: 'measure', hits: 5, beats: 8 });
    expect(screen.getByTestId('mini-tempo-tag').textContent).toBe('소리 꺼짐');
    expect(screen.getByTestId('mini-tempo-headline').textContent).toBe('같은 빠르기로 치세요');
    expect(container.querySelector('.mini-tempo-desc')?.textContent).toBe('예비 박은 끝났어요. 같은 빠르기를 지켜 16번 치세요.');
    expect(screen.getByTestId('mini-tempo-count').textContent).toBe('5 / 16');
    expect(dots()).toHaveLength(16);
    expect(dotsOn()).toBe(5);
    expect(container.querySelectorAll('.mini-tempo-dot-group')).toHaveLength(4);
    expect(screen.getByRole('group', { name: '친 횟수' })).toBeTruthy();
  });

  it('측정 단계에서는 예비 박 수를 보이지 않는다', () => {
    stage({ step: 'measure', beats: 8, hits: 0 });
    expect(screen.queryByRole('group', { name: '예비 박' })).toBeNull();
    expect(screen.getByTestId('mini-tempo-count').textContent).toBe('0 / 16');
  });

  it('카운트다운 단계에서는 숫자가 겹쳐 보인다', () => {
    stage({ phase: 'countdown', countdown: 3 });
    expect(document.querySelector('.play-countdown-value')?.textContent).toBe('3');
  });

  it('플레이 단계에서는 카운트다운이 없다', () => {
    stage({ phase: 'playing', countdown: null });
    expect(document.querySelector('.play-countdown-value')).toBeNull();
  });

  it('빠르기 숫자와 「BPM」이 보인다', () => {
    const { container } = stage({ bpm: 112 });
    expect(screen.getByTestId('mini-tempo-bpm').textContent).toBe('112');
    expect(container.querySelector('.mini-tempo-bpm-unit')?.textContent).toBe('BPM');
  });

  it('[그만하기]를 누르면 onQuit을 부른다', () => {
    const onQuit = vi.fn();
    stage({ onQuit });
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

describe('CountDots', () => {
  it('켜진 점 수만큼 켜고 「n / 합계」를 쓴다', () => {
    render(<CountDots total={8} filled={5} label="예비 박" />);
    expect(dots()).toHaveLength(8);
    expect(dotsOn()).toBe(5);
    expect(screen.getByTestId('mini-tempo-count').textContent).toBe('5 / 8');
  });

  it('켜진 점은 앞에서부터 채운다', () => {
    render(<CountDots total={8} filled={5} label="예비 박" />);
    expect(dots().map((dot) => dot.getAttribute('data-state'))).toEqual(['on', 'on', 'on', 'on', 'on', 'off', 'off', 'off']);
  });

  it('켠 수가 합계를 넘으면 합계로, 음수면 0으로 맞춘다', () => {
    const { unmount } = render(<CountDots total={8} filled={12} label="예비 박" />);
    expect(dotsOn()).toBe(8);
    expect(screen.getByTestId('mini-tempo-count').textContent).toBe('8 / 8');
    unmount();
    render(<CountDots total={8} filled={-3} label="예비 박" />);
    expect(dotsOn()).toBe(0);
    expect(screen.getByTestId('mini-tempo-count').textContent).toBe('0 / 8');
  });

  it('무엇을 세는지 이름은 묶음의 aria-label이다', () => {
    render(<CountDots total={16} filled={0} label="친 횟수" />);
    expect(screen.getByRole('group', { name: '친 횟수' })).toBeTruthy();
  });

  it('점은 화면 낭독기에서 숨기고 읽는 글은 「n / 합계」 하나다', () => {
    const { container } = render(<CountDots total={16} filled={2} label="친 횟수" />);
    expect(container.querySelector('.mini-tempo-dot-row')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.mini-tempo-count')?.textContent).toBe('2 / 16');
  });

  it('4의 배수가 아니면 마지막 묶음이 짧다(합계 6 → 4개 + 2개)', () => {
    const { container } = render(<CountDots total={6} filled={0} label="점" />);
    const groups = Array.from(container.querySelectorAll('.mini-tempo-dot-group'));
    expect(groups.map((group) => group.querySelectorAll('.mini-tempo-dot').length)).toEqual([4, 2]);
  });
});
