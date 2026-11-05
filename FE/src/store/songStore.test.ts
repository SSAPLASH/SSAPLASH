import { beforeEach, describe, expect, it } from 'vitest';
import type { SongSummary } from '@/domain/songCatalog';
import { useSongs } from './songStore';

const song = (over: Partial<SongSummary> = {}): SongSummary => ({
  id: 7,
  title: '별빛 산책',
  artist: '',
  source: 'MIDI',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 60000,
  hasAccompaniment: false,
  accompanimentStatus: 'GENERATING',
  difficulties: ['EASY', 'NORMAL', 'HARD'],
  createdAt: '2026-11-03T00:00:00Z',
  coverUrl: 'https://x/c.jpg',
  ...over,
});

beforeEach(() => useSongs.setState({ scope: 'MINE', items: [song(), song({ id: 8, title: '다른 곡' })], status: 'ready', error: null }));

describe('patchItem', () => {
  it('같은 id 곡의 상태 필드만 바꾸고 목록 전용 값은 그대로 둔다', () => {
    useSongs.getState().patchItem(song({ accompanimentStatus: 'READY', hasAccompaniment: true, difficulties: [], coverUrl: null, title: '상세 제목' }));
    const [a, b] = useSongs.getState().items;
    expect(a.accompanimentStatus).toBe('READY');
    expect(a.hasAccompaniment).toBe(true);
    expect(a.difficulties).toEqual(['EASY', 'NORMAL', 'HARD']);
    expect(a.coverUrl).toBe('https://x/c.jpg');
    expect(a.title).toBe('별빛 산책');
    expect(b.accompanimentStatus).toBe('GENERATING');
  });

  it('목록에 없는 곡이면 무시하고 로딩 상태를 바꾸지 않는다', () => {
    const before = useSongs.getState().items;
    useSongs.getState().patchItem(song({ id: 99, accompanimentStatus: 'FAILED' }));
    expect(useSongs.getState().items.map((s) => s.accompanimentStatus)).toEqual(before.map((s) => s.accompanimentStatus));
    expect(useSongs.getState().status).toBe('ready');
  });
});
