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
  ...over,
});

const render = (s: SongSummary) =>
  renderToStaticMarkup(
    <SongDetailPane song={s} presetName={null} connected={[true, true]} chartState="ready" onRetry={() => {}} onPrepare={() => {}} />,
  );

describe('SongDetailPane 곡 난이도', () => {
  it('메타 줄 끝에 곡 난이도를 붙인다', () => {
    expect(render(song())).toContain('120 BPM · 3:24 · 입문');
    expect(render(song({ songLevel: 'ADVANCED' }))).toContain('· 고급');
  });

  it('곡 난이도가 없으면 메타 줄에서 뺀다', () => {
    const html = render(song({ songLevel: null }));
    expect(html).toContain('120 BPM · 3:24<');
    expect(html).not.toContain('—</p>');
  });
});
