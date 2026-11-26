// 곡 선택 표의 즐겨찾기 별 열 (설계 MODE-001-MODE-003-song-favorite).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
import { SongTable } from './SongTable';

const song = (id: number): SongSummary => ({
  id, title: `곡${id}`, artist: `가수${id}`, source: 'BUILTIN', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 60_000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null, sheetId: null,
});
const SONGS = [song(1), song(2), song(3)];

function html(over: Partial<Parameters<typeof SongTable>[0]> = {}) {
  return renderToStaticMarkup(<SongTable songs={SONGS} selectedId={1} onSelect={() => {}} onOpen={() => {}} {...over} />);
}

describe('SongTable 즐겨찾기 별 열', () => {
  it('favoriteIds·onToggleFavorite가 없으면 별 열을 그리지 않는다', () => {
    const out = html();
    expect(out).not.toContain('play-st-fav');
    expect(out).not.toContain('play-fav');
  });

  it('받으면 행마다 별이 있고 즐겨찾기한 곡만 켜져 있다', () => {
    const out = html({ favoriteIds: new Set([2]), onToggleFavorite: () => {} });
    expect(out).toContain('<th scope="col" class="play-st-fav" aria-label="즐겨찾기"></th>');
    expect(out.match(/class="play-fav play-fav-row/g)).toHaveLength(3);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out.match(/aria-label="즐겨찾기 해제"/g)).toHaveLength(1);
    expect(out.match(/aria-label="즐겨찾기에 추가"/g)).toHaveLength(2);
  });

  it('선택 행의 별만 Tab 순서에 든다', () => {
    const out = html({ favoriteIds: new Set(), onToggleFavorite: () => {} });
    const stops = [...out.matchAll(/<button[^>]*class="play-fav[^>]*>/g)].map((m) => /tabindex="(-?\d)"/.exec(m[0])?.[1]);
    expect(stops).toEqual(['0', '-1', '-1']);
  });

  it('고를 수 없는 곡에는 별을 그리지 않는다', () => {
    const out = html({ favoriteIds: new Set(), onToggleFavorite: () => {}, isLocked: (s) => s.id === 3 });
    expect(out.match(/class="play-fav play-fav-row/g)).toHaveLength(2);
  });

  it('빈 목록의 안내 칸은 별 열까지 차지한다', () => {
    const base = renderToStaticMarkup(<SongTable songs={[]} selectedId={null} onSelect={() => {}} onOpen={() => {}} emptyState="없음" />);
    const withFav = renderToStaticMarkup(
      <SongTable songs={[]} selectedId={null} onSelect={() => {}} onOpen={() => {}} emptyState="없음" favoriteIds={new Set()} onToggleFavorite={() => {}} />,
    );
    expect(base).toContain('colSpan="6"');
    expect(withFav).toContain('colSpan="7"');
  });

  it('countLabel로 아래 줄 곡 수 앞말을 바꾼다', () => {
    expect(html()).toContain('총 3곡');
    expect(html({ countLabel: '즐겨찾기' })).toContain('즐겨찾기 3곡');
  });
});
