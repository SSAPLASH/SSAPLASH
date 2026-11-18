import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/song/songCatalog';
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
    accompanimentStatus: 'NONE',
    songLevel: 'BEGINNER',
    difficulties: ['EASY', 'NORMAL', 'HARD'],
    createdAt: '2026-10-01T00:00:00Z',
    coverUrl: null,
    ...over,
  } as SongSummary;
}

const songs = (n: number) => Array.from({ length: n }, (_, i) => song(i + 1));

function render(p: {
  songs: SongSummary[];
  selectedId?: number | null;
  best?: Map<number, number>;
  accuracy?: Map<number, number>;
  mode?: 'play' | 'sheet';
  isLocked?: (s: SongSummary) => boolean;
  isRecommended?: (s: SongSummary) => boolean;
  emptyState?: ReactNode;
}) {
  return renderToStaticMarkup(
    <SongTable
      songs={p.songs}
      selectedId={p.selectedId ?? null}
      onSelect={() => {}}
      onOpen={() => {}}
      mode={p.mode}
      bestScores={p.best ?? new Map()}
      bestAccuracies={p.accuracy ?? new Map()}
      isLocked={p.isLocked}
      isRecommended={p.isRecommended}
      emptyState={p.emptyState}
    />,
  );
}

describe('SongTable', () => {
  it('6곡이면 한 페이지, 총 6곡', () => {
    const html = render({ songs: songs(6) });
    expect(html.match(/<tr[^>]*data-song-id/g)).toHaveLength(6);
    expect(html).toContain('총 6곡');
    expect(html.match(/class="ui-pg-btn/g)).toHaveLength(5); // «·‹·1·›·»
  });

  it('7곡이면 첫 쪽엔 6곡만, 2페이지, 총 7곡', () => {
    const html = render({ songs: songs(7) });
    expect(html.match(/<tr[^>]*data-song-id/g)).toHaveLength(6);
    expect(html).not.toContain('곡7<');
    expect(html).toContain('총 7곡');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/class="ui-pg-btn/g)).toHaveLength(6); // «·‹·1·2·›·»
  });

  it('열 머리: 커버·제목/아티스트·BPM·길이·곡 난이도·최고 점수 순서', () => {
    const html = render({ songs: songs(1) });
    const heads = [...html.matchAll(/<th [^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['커버', '제목 / 아티스트', 'BPM', '길이', '곡 난이도', '최고 점수']);
  });

  it('곡 난이도는 글자 표기이고 연습 단계 배지를 쓰지 않는다', () => {
    const html = render({ songs: [song(1), song(2, { songLevel: 'INTERMEDIATE' }), song(3, { songLevel: 'ADVANCED' })] });
    for (const t of ['입문', '중급', '고급']) expect(html).toContain(`>${t}</td>`);
    expect(html).not.toContain('song-level');
  });

  it('곡 난이도가 없으면 "—"', () => {
    const html = render({ songs: [song(1, { songLevel: null, bpm: 90 })] });
    expect(html).toMatch(/play-st-level">—<\/td>/);
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
    expect(html.match(/class="ui-pg-btn/g)).toHaveLength(5);
  });

  it('곡이 없으면 머리글을 두고 본문 한 칸(열 전체)에 emptyState를 그린다', () => {
    const html = render({ songs: [], emptyState: <p>빈 안내</p> });
    expect(html).toContain('곡 난이도</th>');
    expect(html).toContain('<tr class="play-st-empty"><td colSpan="6"><p>빈 안내</p></td></tr>');
    expect(html).toContain('총 0곡');
  });

  it('곡이 있으면 emptyState를 그리지 않는다', () => {
    expect(render({ songs: songs(1), emptyState: <p>빈 안내</p> })).not.toContain('빈 안내');
  });

  it('isRecommended가 참인 행만 제목 줄에 「✦ AI 추천」 라벨을 붙인다', () => {
    const html = render({ songs: songs(3), isRecommended: (s) => s.id !== 2 });
    expect(html.match(/class="play-st-ai">✦ AI 추천</g)?.length).toBe(2);
    expect(html).toContain('<span class="play-st-titleline"><span class="play-st-name">곡1</span><span class="play-st-ai">✦ AI 추천</span></span>');
    expect(html).toContain('<span class="play-st-titleline"><span class="play-st-name">곡2</span></span>');
  });

  it('isRecommended가 없으면 라벨이 없다', () => {
    expect(render({ songs: songs(3) })).not.toContain('play-st-ai');
  });
});

describe('SongTable sheet 모드', () => {
  it('열 머리가 「정확도」이고 「최고 점수」는 없다', () => {
    const html = render({ songs: songs(1), mode: 'sheet' });
    expect(html).toContain('>정확도</th>');
    expect(html).not.toContain('최고 점수');
    expect(html.match(/<th /g)).toHaveLength(6);
  });

  it('최고 정확도는 퍼센트, 없으면 "—"', () => {
    const html = render({ songs: songs(2), mode: 'sheet', accuracy: new Map([[1, 0.9876]]) });
    expect(html).toContain('<td class="play-st-num">98.8%</td>');
    expect(html).toContain('<td class="play-st-num">—</td>');
  });

  it('sheet 모드는 최고 점수 Map을 쓰지 않는다', () => {
    const html = render({ songs: songs(1), mode: 'sheet', best: new Map([[1, 1234567]]) });
    expect(html).not.toContain('1,234,567');
  });

  it('play 모드는 최고 점수 그대로(정확도 Map 무시)', () => {
    const html = render({ songs: songs(1), best: new Map([[1, 4200]]), accuracy: new Map([[1, 0.5]]) });
    expect(html).toContain('>최고 점수</th>');
    expect(html).toContain('4,200');
    expect(html).not.toContain('50.0%');
  });
});
