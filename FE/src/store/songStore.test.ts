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
  sheetId: null,
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

describe('load 전체 페이지 (Jira 363)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const pageOf = (url: string) => Number(new URL(url, 'http://x').searchParams.get('page'));

  it('api 소스: 51곡 이상이면 다음 페이지까지 모두 items에 담는다', async () => {
    resetForTest('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const p = pageOf(url);
        const ids = p === 0 ? Array.from({ length: 100 }, (_, i) => i + 1) : [101, 102];
        return ok({ items: ids.map((id) => ({ id, title: `곡${id}`, status: 'READY' })), hasNext: p === 0 });
      }),
    );
    useSongs.setState({ source: 'api' });
    await useSongs.getState().load('BUILTIN');
    expect(useSongs.getState().status).toBe('ready');
    expect(useSongs.getState().items).toHaveLength(102);
    expect(useSongs.getState().items.at(-1)?.id).toBe(102);
  });

  it('로드 중 새 load가 오면 이전 로드는 다음 페이지를 요청하지 않고 결과도 반영하지 않는다', async () => {
    resetForTest('tok');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = vi.fn(async (url: string) => {
      const q = new URL(url, 'http://x').searchParams.get('q');
      if (q === '옛') {
        await gate;
        return ok({ items: [{ id: 1, title: '옛곡', status: 'READY' }], hasNext: true });
      }
      return ok({ items: [{ id: 9, title: '새곡', status: 'READY' }], hasNext: false });
    });
    vi.stubGlobal('fetch', fn);
    useSongs.setState({ source: 'api' });
    const first = useSongs.getState().load('BUILTIN', '옛');
    await useSongs.getState().load('BUILTIN', '새');
    release();
    await first;
    const oldCalls = fn.mock.calls.filter(([u]) => new URL(String(u), 'http://x').searchParams.get('q') === '옛');
    expect(oldCalls).toHaveLength(1);
    expect(useSongs.getState().items.map((s) => s.id)).toEqual([9]);
  });
});
