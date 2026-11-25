// @vitest-environment happy-dom
// OneShotStage·OneShotSongPick·BackingStrip 검증: 값만 받아 그리는 부품이라 props로 상태를 만들어 글과 클래스를 읽는다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ShotOutcome, ShotStep } from '@/features/mini/domain/oneShotRound';
import { BackingStrip } from './BackingStrip';
import { OneShotSongPick } from './OneShotSongPick';
import { OneShotStage } from './OneShotStage';

afterEach(cleanup);

const SONGS = [{ id: 'iwaly', name: 'I Will Always Love You', artist: 'Whitney Houston' }];
const TWO_SONGS = [...SONGS, { id: 'other', name: 'Other Song', artist: 'Someone' }];
const MINUS = '−';

interface StageOver {
  phase?: 'countdown' | 'playing' | 'closing';
  countdown?: number | null;
  step?: ShotStep;
  sweep?: { delayMs: number; durationMs: number } | null;
  outcome?: ShotOutcome | null;
  onQuit?: () => void;
}

function stage(over: StageOver = {}) {
  return render(
    <OneShotStage
      phase={over.phase ?? 'playing'}
      countdown={over.countdown ?? null}
      songs={SONGS}
      songId="iwaly"
      step={over.step ?? 'backing'}
      sweep={over.sweep === undefined ? null : over.sweep}
      outcome={over.outcome ?? null}
      onQuit={over.onQuit ?? (() => undefined)}
    />,
  );
}

const headline = () => screen.getByTestId('mini-oneshot-headline');
const lines = () => Array.from(headline().querySelectorAll('span')).map((el) => el.textContent);
const verdict = () => screen.queryByTestId('mini-oneshot-verdict')?.textContent ?? null;
const desc = () => document.querySelector('.mini-oneshot-desc')?.textContent ?? null;

describe('OneShotStage 큰 문구', () => {
  it('노래가 흐를 때(판정 없음): 「잘 듣고 / 기다리세요」, plain, 아래 안내 한 줄', () => {
    stage({ step: 'backing' });
    expect(lines()).toEqual(['잘 듣고', '기다리세요']);
    expect(headline().classList.contains('is-plain')).toBe(true);
    expect(verdict()).toBeNull();
    expect(desc()).toBe('노래가 돌아올 자리에 딱 한 번 치세요.');
  });

  it('정적일 때(판정 없음): 「딱 한 번 / 치세요」', () => {
    stage({ step: 'rest' });
    expect(lines()).toEqual(['딱 한 번', '치세요']);
    expect(headline().classList.contains('is-plain')).toBe(true);
    expect(desc()).not.toBeNull();
  });

  it('성공: 「+38 ms」·is-good·「늦음 · 성공」, 안내 한 줄은 사라진다', () => {
    stage({ step: 'done', outcome: { kind: 'success', errorMs: 38 } });
    expect(headline().textContent).toBe('+38 ms');
    expect(headline().classList.contains('is-good')).toBe(true);
    expect(verdict()).toBe('늦음 · 성공');
    expect(desc()).toBeNull();
  });

  it('성공 오차 0: 「0 ms」·「정박 · 성공」', () => {
    stage({ step: 'done', outcome: { kind: 'success', errorMs: 0 } });
    expect(headline().textContent).toBe('0 ms');
    expect(verdict()).toBe('정박 · 성공');
  });

  it('범위 밖(miss): 「−81 ms」·is-bad·「빠름 · 실패」', () => {
    stage({ step: 'done', outcome: { kind: 'miss', errorMs: -81 } });
    expect(headline().textContent).toBe(`${MINUS}81 ms`);
    expect(headline().classList.contains('is-bad')).toBe(true);
    expect(verdict()).toBe('빠름 · 실패');
    expect(desc()).toBeNull();
  });

  it('정적 전에 침(before): 「정적 전에 쳤어요」·is-bad·아래 글 없음', () => {
    stage({ step: 'done', outcome: { kind: 'before' } });
    expect(headline().textContent).toBe('정적 전에 쳤어요');
    expect(headline().classList.contains('is-bad')).toBe(true);
    expect(verdict()).toBeNull();
    expect(desc()).toBeNull();
  });

  it('치지 않음(none): 「치지 않았어요」·is-bad·아래 글 없음', () => {
    stage({ step: 'done', outcome: { kind: 'none' } });
    expect(headline().textContent).toBe('치지 않았어요');
    expect(headline().classList.contains('is-bad')).toBe(true);
    expect(verdict()).toBeNull();
    expect(desc()).toBeNull();
  });

  it('큰 문구는 상태 알림(role=status)이고, 정적 동안 박자 표시가 없다는 안내가 있다', () => {
    stage();
    expect(headline().getAttribute('role')).toBe('status');
    expect(screen.getByText('정적 동안에는 박자 표시가 나오지 않아요.')).toBeTruthy();
  });
});

describe('OneShotStage 카운트다운·그만하기', () => {
  it('카운트다운 단계에서는 숫자를 겹쳐 그린다', () => {
    stage({ phase: 'countdown', countdown: 3 });
    expect(document.querySelector('.play-countdown-value')?.textContent).toBe('3');
  });

  it('카운트다운 단계라도 숫자가 없으면 그리지 않고, 다른 단계에서는 그리지 않는다', () => {
    const { unmount } = stage({ phase: 'countdown', countdown: null });
    expect(document.querySelector('.play-countdown-value')).toBeNull();
    unmount();
    stage({ phase: 'playing', countdown: 2 });
    expect(document.querySelector('.play-countdown-value')).toBeNull();
  });

  it('[그만하기]를 누르면 onQuit을 부른다', () => {
    const onQuit = vi.fn();
    stage({ onQuit });
    fireEvent.click(screen.getByRole('button', { name: '그만하기' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('위에 게임 이름이 있고, 곡은 한 줄로 보인다(고르기 없음)', () => {
    stage();
    expect(screen.getByRole('heading', { name: '정적 뒤 한 방' })).toBeTruthy();
    expect(screen.getByTestId('mini-oneshot-song').textContent).toBe('I Will Always Love You · Whitney Houston');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('BackingStrip', () => {
  const strip = (step: ShotStep, sweep: { delayMs: number; durationMs: number } | null) =>
    render(<BackingStrip step={step} sweep={sweep} />);
  const now = () => screen.queryByTestId('mini-oneshot-now');

  it('노래가 흐르고 sweep이 있으면 움직이는 선을 그리고 지연·길이를 인라인으로 준다', () => {
    strip('backing', { delayMs: 350, durationMs: 10000 });
    const style = now()?.getAttribute('style') ?? '';
    expect(style).toContain('animation-delay: 350ms');
    expect(style).toContain('animation-duration: 10000ms');
  });

  it('지연이 음수면 0ms로 둔다', () => {
    strip('backing', { delayMs: -120, durationMs: 10000 });
    const style = now()?.getAttribute('style') ?? '';
    expect(style).toContain('animation-delay: 0ms');
    expect(style).not.toContain('-120');
  });

  it('sweep이 없으면 선이 없다', () => {
    strip('backing', null);
    expect(now()).toBeNull();
  });

  it('정적(rest)과 판정(done)에서는 sweep이 있어도 선이 없다', () => {
    const { unmount } = strip('rest', { delayMs: 0, durationMs: 10000 });
    expect(now()).toBeNull();
    unmount();
    strip('done', { delayMs: 0, durationMs: 10000 });
    expect(now()).toBeNull();
  });

  it('「정적」 라벨이 있고 장식이라 보조기기에서 숨긴다', () => {
    const { container } = strip('rest', null);
    expect(screen.getByText('정적')).toBeTruthy();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('OneShotSongPick', () => {
  it('곡이 하나면 「이름 · 가수」 한 줄이고 고르기는 없다', () => {
    render(<OneShotSongPick songs={SONGS} value="iwaly" />);
    expect(screen.getByTestId('mini-oneshot-song').textContent).toBe('I Will Always Love You · Whitney Houston');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByTestId('mini-oneshot-pick')).toBeNull();
  });

  it('곡이 둘이면 「곡」 라디오 그룹에 두 곡의 이름이 있고 고른 곡이 체크돼 있다', () => {
    render(<OneShotSongPick songs={TWO_SONGS} value="iwaly" onChange={() => undefined} />);
    expect(screen.getByTestId('mini-oneshot-pick')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: '곡' })).toBeTruthy();
    expect(screen.queryByTestId('mini-oneshot-song')).toBeNull();
    const first = screen.getByRole('radio', { name: 'I Will Always Love You' });
    const second = screen.getByRole('radio', { name: 'Other Song' });
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(second.getAttribute('aria-checked')).toBe('false');
  });

  it('다른 곡을 누르면 그 id로 onChange를 부른다', () => {
    const onChange = vi.fn();
    render(<OneShotSongPick songs={TWO_SONGS} value="iwaly" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Other Song' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('other');
  });

  it('locked면 모든 곡이 눌리지 않는다', () => {
    const onChange = vi.fn();
    render(<OneShotSongPick songs={TWO_SONGS} value="iwaly" locked onChange={onChange} />);
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Other Song' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('곡이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<OneShotSongPick songs={[]} value="" />);
    expect(container.firstChild).toBeNull();
  });
});
