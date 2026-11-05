import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/auth';
import { BUILTIN_CHARTS } from '@/domain/chart';
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
  songLevel: null,
  difficulties: ['EASY', 'NORMAL', 'HARD'],
  createdAt: '2026-11-03T00:00:00Z',
  coverUrl: 'https://x/c.jpg',
  ...over,
});

beforeEach(() => useSongs.setState({ scope: 'MINE', items: [song(), song({ id: 8, title: '다른 곡' })], status: 'ready', error: null }));

describe('patchItem', () => {
  it('같은 id 곡의 상태 필드만 바꾸고 목록 전용 값은 그대로 둔다', () => {
    useSongs
      .getState()
      .patchItem(song({ accompanimentStatus: 'READY', hasAccompaniment: true, songLevel: 'ADVANCED', difficulties: [], coverUrl: null, title: '상세 제목' }));
    const [a, b] = useSongs.getState().items;
    expect(a.accompanimentStatus).toBe('READY');
    expect(a.hasAccompaniment).toBe(true);
    expect(a.songLevel).toBe('ADVANCED');
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

describe('load 목록 조건', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('api 소스: 난이도·플레이 후보 조건을 목록 요청에 싣는다', async () => {
    resetForTest('tok');
    const fn = vi.fn(async (_url: string) => new Response(JSON.stringify({ items: [], hasNext: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fn);
    useSongs.setState({ source: 'api' });
    await useSongs.getState().load('BUILTIN', '', { songLevel: 'BEGINNER', playableOnly: true });
    const qs = new URL(String(fn.mock.calls[0][0]), 'http://x').searchParams;
    expect(qs.get('songLevel')).toBe('BEGINNER');
    expect(qs.get('playableOnly')).toBe('true');
  });

  it('api 소스: 조건을 생략하면 쿼리도 없다(내 곡)', async () => {
    resetForTest('tok');
    const fn = vi.fn(async (_url: string) => new Response(JSON.stringify({ items: [], hasNext: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fn);
    useSongs.setState({ source: 'api' });
    await useSongs.getState().load('MINE');
    const qs = new URL(String(fn.mock.calls[0][0]), 'http://x').searchParams;
    expect(qs.has('songLevel')).toBe(false);
    expect(qs.has('playableOnly')).toBe(false);
  });

  it('내장 소스: playableOnly는 무시하고, 난이도 필터를 걸면 빈 목록(내장 곡은 난이도 없음)', async () => {
    useSongs.setState({ source: 'builtin' });
    await useSongs.getState().load('BUILTIN', '', { playableOnly: true });
    expect(useSongs.getState().items).toHaveLength(BUILTIN_CHARTS.length);
    expect(useSongs.getState().items.every((s) => s.songLevel === null)).toBe(true);
    await useSongs.getState().load('BUILTIN', '', { songLevel: 'BEGINNER', playableOnly: true });
    expect(useSongs.getState().items).toEqual([]);
    expect(useSongs.getState().status).toBe('ready');
  });
});
