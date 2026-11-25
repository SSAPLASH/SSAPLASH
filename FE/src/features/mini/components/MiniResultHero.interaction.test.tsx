// @vitest-environment happy-dom
// MiniResultHero 검증: 제목·점수 칸, 「새 최고 기록」, 꼬리표(P11)와 가운데 버튼, [다시 하기] 포커스·콜백, 목록 링크.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MiniResultHero } from '@/features/mini/components/MiniResultHero';

afterEach(cleanup);

type Props = Partial<Parameters<typeof MiniResultHero>[0]>;

function open(props: Props = {}, path = '/play/mini/speed') {
  const onRetry = props.onRetry ?? vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <MiniResultHero
        overline="누구보다 빠르게"
        newBest={false}
        title={['10초에 68타.', '첫 기록이에요.']}
        score={{ label: '기록', value: '68', unit: '타', note: '초당 6.8타' }}
        {...props}
        onRetry={onRetry}
      />
    </MemoryRouter>,
  );
  return { ...view, onRetry };
}

describe('MiniResultHero 내용', () => {
  it('제목 두 줄과 점수 칸(라벨·값·단위·아래 한 줄)이 넘긴 대로 보인다', () => {
    const { container } = open();
    expect(screen.getByText('10초에 68타.')).toBeTruthy();
    expect(screen.getByText('첫 기록이에요.')).toBeTruthy();
    expect(screen.getByText('누구보다 빠르게')).toBeTruthy();
    expect(container.querySelector('.mini-score-label')?.textContent).toBe('기록');
    expect(container.querySelector('.mini-score-value')?.textContent).toBe('68타');
    expect(container.querySelector('.mini-score-unit')?.textContent).toBe('타');
    expect(container.querySelector('.mini-score-note')?.textContent).toBe('초당 6.8타');
  });

  it('단위·아래 한 줄을 넘기지 않으면 그 요소가 없다', () => {
    const { container } = open({ score: { label: '기록', value: '0.42' } });
    expect(container.querySelector('.mini-score-value')?.textContent).toBe('0.42');
    expect(container.querySelector('.mini-score-unit')).toBeNull();
    expect(container.querySelector('.mini-score-note')).toBeNull();
  });

  it('newBest가 참일 때만 「새 최고 기록」이 보인다', () => {
    open({ newBest: false });
    expect(screen.queryByText('새 최고 기록')).toBeNull();
    cleanup();
    open({ newBest: true });
    expect(screen.getByText('새 최고 기록')).toBeTruthy();
  });
});

describe('MiniResultHero 꼬리표(P11)', () => {
  it('tag를 넘기면 위 작은 글 앞에 보인다', () => {
    const { container } = open({ tag: { text: '성공', tone: 'good' } });
    const kids = Array.from(container.querySelector('.mini-result-top')?.children ?? []);
    const tagIndex = kids.findIndex((el) => el.textContent === '성공');
    const overlineIndex = kids.findIndex((el) => el.textContent === '누구보다 빠르게');
    expect(tagIndex).toBeGreaterThanOrEqual(0);
    expect(overlineIndex).toBeGreaterThan(tagIndex);
  });

  it('색조가 클래스로 구분된다(good / bad)', () => {
    open({ tag: { text: '성공', tone: 'good' } });
    expect(screen.getByText('성공').className).toContain('mini-pill-good');
    expect(screen.getByText('성공').className).not.toContain('mini-pill-bad');
    cleanup();
    open({ tag: { text: '실패', tone: 'bad' } });
    expect(screen.getByText('실패').className).toContain('mini-pill-bad');
    expect(screen.getByText('실패').className).not.toContain('mini-pill-good');
  });

  it('넘기지 않으면 꼬리표가 없다', () => {
    const { container } = open();
    expect(container.querySelector('.mini-pill-good, .mini-pill-bad')).toBeNull();
  });
});

describe('MiniResultHero 버튼', () => {
  it('[다시 하기]를 누르면 onRetry가 불린다', () => {
    const { onRetry } = open();
    fireEvent.click(screen.getByRole('button', { name: '다시 하기' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('열릴 때 [다시 하기]가 포커스를 받는다', () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다시 하기' }));
  });

  it('[미니게임 목록]과 「← 미니게임」은 이 게임을 고른 목록(/play/mini?game=speed)으로 간다', () => {
    open();
    expect(screen.getByRole('link', { name: '미니게임 목록' }).getAttribute('href')).toBe('/play/mini?game=speed');
    expect(screen.getByRole('link', { name: '← 미니게임' }).getAttribute('href')).toBe('/play/mini?game=speed');
  });

  it('다른 게임 화면이면 그 게임을 고른 목록으로 간다', () => {
    open({}, '/play/mini/tempo');
    expect(screen.getByRole('link', { name: '미니게임 목록' }).getAttribute('href')).toBe('/play/mini?game=tempo');
    expect(screen.getByRole('link', { name: '← 미니게임' }).getAttribute('href')).toBe('/play/mini?game=tempo');
  });

  it('게임 화면 경로가 아니면 주소 값 없는 목록(/play/mini)으로 간다', () => {
    open({}, '/');
    expect(screen.getByRole('link', { name: '미니게임 목록' }).getAttribute('href')).toBe('/play/mini');
    expect(screen.getByRole('link', { name: '← 미니게임' }).getAttribute('href')).toBe('/play/mini');
  });

  it('extraAction을 넘기면 [다시 하기]와 [미니게임 목록] 사이에 보이고 누르면 콜백이 불린다', () => {
    const onClick = vi.fn();
    const { container } = open({ extraAction: { label: '박자 맞추기', onClick } });
    const labels = Array.from(container.querySelectorAll('.mini-result-actions > *')).map((el) => el.textContent);
    expect(labels).toEqual(['다시 하기', '박자 맞추기', '미니게임 목록']);
    fireEvent.click(screen.getByRole('button', { name: '박자 맞추기' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('extraAction을 넘기지 않으면 버튼이 둘뿐이다', () => {
    const { container } = open();
    const labels = Array.from(container.querySelectorAll('.mini-result-actions > *')).map((el) => el.textContent);
    expect(labels).toEqual(['다시 하기', '미니게임 목록']);
  });
});
