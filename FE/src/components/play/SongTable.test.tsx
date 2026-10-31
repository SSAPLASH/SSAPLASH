import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/songCatalog';
import { SongTable } from './SongTable';

function song(id: number, over: Partial<SongSummary> = {}): SongSummary {
  return {
    id,
    title: `곡${id}`,
    artist: `가수${id}`,
    source: 'BUILTIN',
    status: 'READY',
    bpm: 120,
    timeSignature: '4/4',
    durationMs: 185_000,
    hasAccompaniment: false,
    difficulties: ['EASY', 'NORMAL', 'HARD'],
    createdAt: '2026-10-01T00:00:00Z',
    coverUrl: null,
    ...over,
  } as SongSummary;
}

const songs = (n: number) => Array.from({ length: n }, (_, i) => song(i + 1));

function render(p: { songs: SongSummary[]; selectedId?: number | null; best?: Map<number, number>; isLocked?: (s: SongSummary) => boolean }) {
  return renderToStaticMarkup(
    <SongTable
      songs={p.songs}
      selectedId={p.selectedId ?? null}
      onSelect={() => {}}
      onOpen={() => {}}
      bestScores={p.best ?? new Map()}
      isLocked={p.isLocked}
    />,
  );
}

describe('SongTable', () => {
  it('6곡이면 한 페이지, 총 6곡', () => {
    const html = render({ songs: songs(6) });
    expect(html.match(/<tr[^>]*data-song-id/g)).toHaveLength(6);
    expect(html).toContain('총 6곡');
    expect(html.match(/class="play-st-pg/g)).toHaveLength(3); // 이전·1·다음
  });

  it('7곡이면 첫 쪽엔 6곡만, 2페이지, 총 7곡', () => {
    const html = render({ songs: songs(7) });
    expect(html.match(/<tr[^>]*data-song-id/g)).toHaveLength(6);
    expect(html).not.toContain('곡7<');
    expect(html).toContain('총 7곡');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/class="play-st-pg/g)).toHaveLength(4); // 이전·1·2·다음
  });

  it('열 머리: 커버·제목/아티스트·BPM·길이·최고 점수, 난이도 열은 없다(U17)', () => {
    const html = render({ songs: songs(1) });
    for (const h of ['커버', '제목 / 아티스트', 'BPM', '길이', '최고 점수']) expect(html).toContain(`>${h}</th>`);
    expect(html.match(/<th /g)).toHaveLength(5);
    expect(html).not.toContain('난이도');
    expect(html).not.toContain('song-level');
  });

  it('선택 행 표시', () => {
    const html = render({ songs: songs(3), selectedId: 2 });
    expect(html.match(/play-st-row selected/g)).toHaveLength(1);
    expect(html).toMatch(/data-song-id="2"[^>]*aria-selected="true"/);
    expect(html).toMatch(/data-song-id="1"[^>]*aria-selected="false"/);
  });

  it('최고 점수는 콤마, 없으면 "—"', () => {
    const html = render({ songs: songs(2), best: new Map([[1, 1234567]]) });
    expect(html).toContain('1,234,567');
    expect(html).toContain('<td class="play-st-num">—</td>');
  });

  it('잠긴 곡은 locked·aria-disabled와 상태 문구', () => {
    const songList = [song(1), song(2, { status: 'PROCESSING' })];
    const html = render({ songs: songList, isLocked: (s) => s.status !== 'READY' });
    expect(html.match(/play-st-row locked/g)).toHaveLength(1);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('채보 생성 중');
  });

  it('잠기지 않은 곡엔 상태 문구가 없다', () => {
    expect(render({ songs: songs(2) })).not.toContain('play-st-status');
  });

  it('길이가 null이면 "—", BPM은 반올림', () => {
    const html = render({ songs: [song(1, { durationMs: null, bpm: 99.6 })] });
    expect(html).toContain('>100</td>');
    expect(html).toContain('<td class="play-st-num">—</td>');
  });

  it('곡이 없어도 1페이지·총 0곡', () => {
    const html = render({ songs: [] });
    expect(html).toContain('총 0곡');
    expect(html.match(/class="play-st-pg/g)).toHaveLength(3);
  });
});
