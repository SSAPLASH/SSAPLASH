// @vitest-environment happy-dom
// MiniHero 검증: 고른 게임의 이름·꼬리표·규칙·설명·그림, 기록 줄(값·단위·표시 형식·기록 없음), [시작] 콜백.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MiniHero } from '@/features/mini/components/MiniHero';
import type { MiniGameInfo } from '@/features/mini/domain/miniCatalog';
import type { HeroRecordRow, MiniRecord } from '@/features/mini/domain/miniRecord';

afterEach(cleanup);

const INFO: MiniGameInfo = {
  id: 'speed',
  name: '누구보다 빠르게',
  rule: '10초 동안 스네어 가장 많이 치기',
  tag: '10초',
  description: '스네어를 친 것만 셉니다. 카운트다운이 끝나면 바로 시작해요.',
  unit: '타',
  better: 'higher',
};

function record(score: number, variant?: string): MiniRecord {
  const base = { gameId: 'speed' as const, score, at: '2026-11-24T10:00:00.000Z', detail: { perSecond: [score, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
  return variant === undefined ? base : { ...base, variant };
}

type Props = Partial<Parameters<typeof MiniHero>[0]>;

function open(props: Props = {}) {
  const onStart = props.onStart ?? vi.fn();
  const rows: readonly HeroRecordRow[] = props.rows ?? [{ label: '최고 기록', record: null }];
  const view = render(<MiniHero info={INFO} art={null} {...props} rows={rows} onStart={onStart} />);
  return { ...view, onStart };
}

/** 기록 줄(이름·값)을 화면 글자로 */
function rowTexts(container: HTMLElement): [string | null, string | null][] {
  return Array.from(container.querySelectorAll('.mini-hero-row')).map((row) => [
    row.querySelector('dt')?.textContent ?? null,
    row.querySelector('dd')?.textContent ?? null,
  ]);
}

describe('MiniHero 구성', () => {
  it('게임 이름이 제목(h3)이고 영역의 이름표가 된다', () => {
    open();
    const name = screen.getByRole('heading', { level: 3, name: '누구보다 빠르게' });
    const region = screen.getByRole('region', { name: '누구보다 빠르게' });
    expect(region.contains(name)).toBe(true);
    expect(region.classList.contains('mini-hero')).toBe(true);
  });

  it('게임 id가 data-game에 실린다(색은 이 값으로 정한다)', () => {
    const { container } = open({ info: { ...INFO, id: 'tempo' } });
    expect(container.querySelector('.mini-hero')?.getAttribute('data-game')).toBe('tempo');
  });

  it('꼬리표·한 줄 규칙·그림이 보인다', () => {
    const { container } = open({ art: <span data-testid="art" /> });
    expect(container.querySelector('.mini-hero-tag')?.textContent).toBe('10초');
    expect(screen.getByText('10초 동안 스네어 가장 많이 치기')).toBeTruthy();
    expect(container.querySelector('.mini-hero-art')?.contains(screen.getByTestId('art'))).toBe(true);
  });

  it('「게임 방법」 아래에 설명 글이 그대로 보인다', () => {
    open();
    expect(screen.getByRole('heading', { level: 4, name: '게임 방법' })).toBeTruthy();
    expect(screen.getByText('스네어를 친 것만 셉니다. 카운트다운이 끝나면 바로 시작해요.')).toBeTruthy();
  });
});

describe('MiniHero 기록 줄', () => {
  it('기록이 있으면 값과 단위가 보인다', () => {
    const { container } = open({ rows: [{ label: '최고 기록', record: record(68) }] });
    expect(rowTexts(container)).toEqual([['최고 기록', '68타']]);
    expect(screen.queryByText('아직 기록이 없어요')).toBeNull();
  });

  it('기록이 없으면 그 줄에 「아직 기록이 없어요」가 보이고 값은 없다', () => {
    const { container } = open({ rows: [{ label: '최고 기록', record: null }] });
    expect(rowTexts(container)).toEqual([['최고 기록', '아직 기록이 없어요']]);
    expect(container.querySelector('.mini-hero-value')).toBeNull();
  });

  it('표시 형식이 있으면 그 형식으로 보인다(420 → 0.42초)', () => {
    const info: MiniGameInfo = { ...INFO, unit: '초', better: 'lower', format: (ms) => (ms / 1000).toFixed(2) };
    const { container } = open({ info, rows: [{ label: '최고 기록', record: record(420) }] });
    expect(rowTexts(container)).toEqual([['최고 기록', '0.42초']]);
  });

  it('줄이 여럿이면 받은 순서대로 모두 보이고, 기록이 없는 줄만 비어 있다', () => {
    const rows: HeroRecordRow[] = [
      { label: '힌트 끔', record: null },
      { label: '힌트 켬', record: record(41, 'hint-on') },
    ];
    const { container } = open({ rows });
    expect(rowTexts(container)).toEqual([
      ['힌트 끔', '아직 기록이 없어요'],
      ['힌트 켬', '41타'],
    ]);
  });

  it('기록 줄은 이름–값 목록(dl)이다', () => {
    const { container } = open({ rows: [{ label: '최고 기록', record: record(68) }] });
    const list = container.querySelector('dl.mini-hero-rows') as HTMLElement;
    expect(within(list).getByText('최고 기록').tagName).toBe('DT');
  });
});

describe('MiniHero [시작]', () => {
  it('버튼은 하나이고 이름표가 「{게임 이름} 시작」이다', () => {
    open();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const start = screen.getByRole('button', { name: '누구보다 빠르게 시작' });
    expect(start.textContent).toBe('시작');
  });

  it('누르면 onStart가 한 번 불린다', () => {
    const { onStart } = open();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '누구보다 빠르게 시작' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('기록이 없어도 [시작]은 켜져 있다', () => {
    open({ rows: [{ label: '최고 기록', record: null }] });
    expect((screen.getByRole('button', { name: '누구보다 빠르게 시작' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
