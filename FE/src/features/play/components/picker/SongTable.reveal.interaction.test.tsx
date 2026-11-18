// @vitest-environment happy-dom
// 주소로 골라 둔 곡(revealId): 그 곡이 있는 쪽을 연다(다시 하기·추천·세팅 복귀).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
import { SongTable } from './SongTable';

afterEach(cleanup);

const song = (id: number): SongSummary =>
  ({
    id,
    title: `곡${id}`,
    artist: `가수${id}`,
    source: 'BUILTIN',
    status: 'READY',
    bpm: 120,
    timeSignature: '4/4',
    durationMs: 185_000,
    hasAccompaniment: false,
    accompanimentStatus: 'NONE',
    songLevel: 'BEGINNER',
    difficulties: ['EASY', 'NORMAL', 'HARD'],
    createdAt: '2026-10-01T00:00:00Z',
    coverUrl: null,
  }) as SongSummary;
const songs = Array.from({ length: 8 }, (_, i) => song(i + 1));
const rowIds = () => [...document.querySelectorAll<HTMLElement>('[data-song-id]')].map((r) => r.dataset.songId);

function show(p: { revealId?: number | null }) {
  return render(
    <>
      <SongTable
        songs={songs}
        selectedId={p.revealId ?? null}
        onSelect={() => {}}
        onOpen={() => {}}
        revealId={p.revealId}
      />
    </>,
  );
}

describe('SongTable 골라 둔 곡 보이기', () => {
  it('revealId가 없으면 첫 쪽을 보인다', () => {
    show({});
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('revealId 곡이 둘째 쪽에 있으면 둘째 쪽을 연다', () => {
    show({ revealId: 8 });
    expect(rowIds()).toEqual(['7', '8']);
  });

  it('목록에 없는 revealId는 첫 쪽을 보인다', () => {
    show({ revealId: 99 });
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('사용자가 쪽을 넘기면 revealId를 더 따르지 않는다', () => {
    show({ revealId: 8 });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(rowIds()).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});
