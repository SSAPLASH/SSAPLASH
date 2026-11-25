// @vitest-environment happy-dom
// MiniCard 검증: 최고 기록 표시 형식, 갈래 꼬리말, 기록 없음 문구, 고르기 버튼(고름 표시·누름·두 번 누름).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MiniCard } from '@/features/mini/components/MiniCard';
import type { MiniGameInfo } from '@/features/mini/domain/miniCatalog';
import type { MiniRecord } from '@/features/mini/domain/miniRecord';

afterEach(cleanup);

const INFO: MiniGameInfo = {
  id: 'speed',
  name: '누구보다 빠르게',
  rule: '10초 동안 스네어 가장 많이 치기',
  tag: '10초',
  description: '스네어를 친 것만 셉니다.',
  unit: '타',
  better: 'higher',
};

function record(score: number): MiniRecord {
  return { gameId: 'speed', score, at: '2026-11-24T10:00:00.000Z', detail: { perSecond: [score, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
}

type Props = Partial<Parameters<typeof MiniCard>[0]>;

function open(props: Props = {}) {
  const onSelect = props.onSelect ?? vi.fn();
  const onOpen = props.onOpen ?? vi.fn();
  const view = render(<MiniCard info={INFO} record={null} art={null} selected={false} {...props} onSelect={onSelect} onOpen={onOpen} />);
  return { ...view, onSelect, onOpen };
}

function value(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.mini-card-value');
}

describe('MiniCard 최고 기록 표시', () => {
  it('표시 형식이 없으면 숫자 그대로 보이고 단위가 붙는다', () => {
    const { container } = open({ record: record(68) });
    expect(value(container)?.textContent).toBe('68타');
    expect(screen.queryByText('아직 기록이 없어요')).toBeNull();
  });

  it('표시 형식이 있으면 그 형식으로 보인다(420 → 0.42)', () => {
    const info: MiniGameInfo = { ...INFO, unit: '초', better: 'lower', format: (ms) => (ms / 1000).toFixed(2) };
    const { container } = open({ info, record: record(420) });
    expect(value(container)?.textContent).toBe('0.42초');
    expect(screen.queryByText('420')).toBeNull();
  });

  it('variantName을 넘기면 값 뒤에 갈래 이름이 붙는다', () => {
    const { container } = open({ record: record(68), variantName: '힌트 끔' });
    expect(value(container)?.textContent).toBe('68타힌트 끔');
    expect(container.querySelector('.mini-card-variant')?.textContent).toBe('힌트 끔');
  });

  it('variantName을 넘기지 않으면 갈래 이름이 없다', () => {
    const { container } = open({ record: record(68) });
    expect(container.querySelector('.mini-card-variant')).toBeNull();
  });

  it('기록이 없으면 「아직 기록이 없어요」만 보이고 값은 없다', () => {
    const { container } = open({ record: null });
    expect(screen.getByText('아직 기록이 없어요')).toBeTruthy();
    expect(value(container)).toBeNull();
  });

  it('기록이 없을 때는 variantName을 넘겨도 갈래 이름이 없다', () => {
    const { container } = open({ record: null, variantName: '힌트 끔' });
    expect(container.querySelector('.mini-card-variant')).toBeNull();
  });
});

describe('MiniCard 구성', () => {
  it('카드 전체가 버튼 하나이고 이름·규칙·꼬리표·그림을 담는다', () => {
    open({ art: <span data-testid="art" /> });
    const card = screen.getByRole('button');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(card.classList.contains('mini-card')).toBe(true);
    expect(card.getAttribute('data-game')).toBe('speed');
    expect(card.querySelector('.mini-card-name')?.textContent).toBe('누구보다 빠르게');
    expect(card.querySelector('.mini-card-rule')?.textContent).toBe('10초 동안 스네어 가장 많이 치기');
    expect(card.querySelector('.mini-card-tag')?.textContent).toBe('10초');
    expect(card.contains(screen.getByTestId('art'))).toBe(true);
  });

  it('카드에는 [시작] 버튼이 없다(시작은 큰 카드에서 한다)', () => {
    open();
    expect(screen.queryByRole('button', { name: '누구보다 빠르게 시작' })).toBeNull();
    expect(screen.queryByText('시작')).toBeNull();
  });

  it('설명 글은 카드에 보이지 않는다(큰 카드가 보인다)', () => {
    open();
    expect(screen.queryByText('스네어를 친 것만 셉니다.')).toBeNull();
  });
});

describe('MiniCard 고르기', () => {
  it('고르지 않은 카드는 aria-pressed가 false이고 고름 표시가 없다', () => {
    open({ selected: false });
    const card = screen.getByRole('button');
    expect(card.getAttribute('aria-pressed')).toBe('false');
    expect(card.classList.contains('is-selected')).toBe(false);
  });

  it('고른 카드는 aria-pressed가 true이고 고름 표시(is-selected)가 붙는다', () => {
    open({ selected: true });
    const card = screen.getByRole('button');
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(card.classList.contains('is-selected')).toBe(true);
  });

  it('누르면 onSelect만 불린다', () => {
    const { onSelect, onOpen } = open();
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('이미 고른 카드를 눌러도 onSelect가 불린다(막지 않는다)', () => {
    const { onSelect } = open({ selected: true });
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('두 번 누르면(더블클릭) onOpen이 불린다', () => {
    const { onOpen } = open();
    fireEvent.doubleClick(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('submit 버튼이 아니다(type="button")', () => {
    open();
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});
