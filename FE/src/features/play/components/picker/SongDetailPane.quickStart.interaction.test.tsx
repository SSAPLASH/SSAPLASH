// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
import { SongDetailPane, type QuickStartProps, type SongDetailPaneProps } from './SongDetailPane';

afterEach(cleanup);

const song: SongSummary = {
  id: 1,
  title: '별빛 산책',
  artist: '파란물결',
  source: 'BUILTIN',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 204_000,
  hasAccompaniment: false,
  accompanimentStatus: 'NONE',
  songLevel: 'BEGINNER',
  difficulties: ['EASY', 'NORMAL'],
  createdAt: '',
  coverUrl: null,
  sheetId: null,
};

function setup(quick: Partial<QuickStartProps> = {}, over: Partial<SongDetailPaneProps> = {}) {
  const q: QuickStartProps = {
    charts: [
      { id: 11, difficulty: 'EASY' },
      { id: 12, difficulty: 'NORMAL' },
    ],
    selectedChartId: 12,
    onSelectChart: vi.fn(),
    bestByChart: { 11: 0.5, 12: 0.9 },
    onStart: vi.fn(),
    ...quick,
  };
  render(<SongDetailPane song={song} presetName="내 킷" chartState="ready" onRetry={() => {}} quickStart={q} {...over} />);
  return q;
}

describe('SongDetailPane quickStart', () => {
  it('starting이면 ▶ 플레이 자리가 스피너(비활성)이고, 아니면 글자 「플레이」다', () => {
    setup({ starting: true });
    const btn = document.querySelector('.play-sd-play') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('.spinner')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '플레이' })).toBeNull();
    cleanup();
    setup();
    expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('.play-sd-play .spinner')).toBeNull();
  });

  it('제목 묶음·기록 두 칸(최고 정확도 | 프리셋)·단계 세그먼트·플레이가 보인다', () => {
    setup();
    expect(screen.getByText('BPM 120 · 3:24 · 입문')).toBeTruthy();
    expect(screen.getByText('최고 정확도')).toBeTruthy();
    expect(screen.getByText('프리셋')).toBeTruthy();
    expect(screen.getByText('내 킷')).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['EASY', 'NORM', 'HARD']);
    expect(screen.getByRole('button', { name: '플레이' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '준비' })).toBeNull();
  });

  it('그 곡에 없는 단계는 비활성이고, 고른 단계의 최고 정확도를 보인다', () => {
    setup();
    const [easy, norm, hard] = screen.getAllByRole('radio') as HTMLButtonElement[];
    expect(hard.disabled).toBe(true);
    expect(easy.disabled).toBe(false);
    expect(norm.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('90.0%')).toBeTruthy();
  });

  it('단계를 누르면 그 채보 id로 onSelectChart, 기록이 없으면 —', async () => {
    const q = setup({ selectedChartId: 11, bestByChart: { 11: undefined } });
    expect(screen.getByText('—')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'NORM' }));
    expect(q.onSelectChart).toHaveBeenCalledWith(12);
  });

  it('비활성 단계는 눌러도 아무 일이 없다', async () => {
    const q = setup();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'HARD' }));
    expect(q.onSelectChart).not.toHaveBeenCalled();
  });

  it('[플레이] → onStart, 채보 조회 전·오류면 비활성', async () => {
    const q = setup();
    await userEvent.setup().click(screen.getByRole('button', { name: '플레이' }));
    expect(q.onStart).toHaveBeenCalledTimes(1);
    cleanup();
    setup({}, { chartState: 'loading' });
    expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bestKind=score면 기록 칸이 「최고 점수」이고 고른 단계의 점수를 쉼표 정수로 보인다', () => {
    setup({ bestKind: 'score', bestByChart: { 11: 800, 12: 1234567 } });
    expect(screen.getByText('최고 점수')).toBeTruthy();
    expect(screen.queryByText('최고 정확도')).toBeNull();
    expect(screen.getByText('1,234,567')).toBeTruthy();
  });

  it('bestKind=score에 기록이 없으면 —', () => {
    setup({ bestKind: 'score', selectedChartId: 11, bestByChart: {} });
    expect(screen.getByText('최고 점수')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
});
