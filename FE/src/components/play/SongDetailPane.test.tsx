import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/songCatalog';
import { SongDetailPane } from './SongDetailPane';

const song = (over: Partial<SongSummary> = {}): SongSummary => ({
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
  difficulties: ['NORMAL'],
  createdAt: '',
  coverUrl: null,
  sheetId: null,
  ...over,
});

const render = (s: SongSummary, over: Partial<Parameters<typeof SongDetailPane>[0]> = {}) =>
  renderToStaticMarkup(
    <SongDetailPane song={s} presetName={null} chartState="ready" onRetry={() => {}} onPrepare={() => {}} {...over} />,
  );

describe('SongDetailPane 곡 난이도', () => {
  it('메타 줄 끝에 곡 난이도를 붙인다', () => {
    expect(render(song())).toContain('BPM 120 · 3:24 · 입문');
    expect(render(song({ songLevel: 'ADVANCED' }))).toContain('· 고급');
  });

  it('곡 난이도가 없으면 메타 줄에서 뺀다', () => {
    const html = render(song({ songLevel: null }));
    expect(html).toContain('BPM 120 · 3:24<');
    expect(html).not.toContain('—</p>');
  });
});

describe('SongDetailPane 준비 줄', () => {
  it('[프리셋 · 준비]가 한 줄이고 스틱 연결 문구가 없다', () => {
    const html = render(song(), { presetName: '기본 세트' });
    expect(html).toMatch(/<div class="play-sd-ready"><p class="play-sd-line">프리셋: 기본 세트<\/p><button[^>]*class="[^"]*play-sd-prepare[^"]*"[^>]*>준비<\/button><\/div>/);
    expect(html).not.toContain('연결');
    expect(html).not.toContain('키보드 입력');
  });

  it('프리셋이 없으면 「시스템 기본」, 채보 준비 전에는 [준비]가 꺼진다', () => {
    const html = render(song(), { chartState: 'loading' });
    expect(html).toContain('프리셋: 시스템 기본');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>준비<\/button>/);
  });
});

describe('SongDetailPane 비슷한 곡', () => {
  const similar = { song: song({ id: 9, title: '도시의 리듬', artist: '모노레일', songLevel: 'ADVANCED' }), chartId: 90, difficulty: 'NORMAL' as const, line: '리듬이 비슷해요' };

  it('[준비] 줄 아래 구분선과 캡션·제목·「아티스트 · 곡 난이도」·이유·[이 곡 보기]를 그린다', () => {
    const html = render(song(), { similar });
    expect(html).toMatch(/play-sd-ready.*<\/div><hr class="play-sd-divider"\/><section class="play-sd-similar" aria-label="이 곡과 비슷한 곡">/);
    expect(html).toContain('>✦ 이 곡과 비슷한 곡<');
    expect(html).toContain('<span class="play-sd-similar-title">도시의 리듬</span>');
    expect(html).toContain('<span class="play-sd-similar-meta">모노레일 · 고급</span>');
    expect(html).toContain('<span class="play-sd-similar-reason">리듬이 비슷해요</span>');
    expect(html).toMatch(/<button[^>]*play-sd-similar-pick[^>]*>이 곡 보기<\/button>/);
  });

  it('이유가 비면 이유 줄이 없고, 곡 난이도가 없으면 아티스트만', () => {
    const html = render(song(), { similar: { ...similar, line: '', song: { ...similar.song, songLevel: null } } });
    expect(html).not.toContain('play-sd-similar-reason');
    expect(html).toContain('<span class="play-sd-similar-meta">모노레일</span>');
  });

  it('비슷한 곡이 없으면 구분선까지 없다', () => {
    const html = render(song());
    expect(html).not.toContain('play-sd-divider');
    expect(html).not.toContain('play-sd-similar');
  });
});
