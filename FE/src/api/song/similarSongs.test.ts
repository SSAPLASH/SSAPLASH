import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { ApiError } from '@/api/http';
import { fetchSimilarSongs } from './similarSongs';

const songDto = {
  id: 12, title: '곡', artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 90000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null,
};

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('fetchSimilarSongs', () => {
  it('경로에 songId를, 쿼리에 difficulty·size를 싣는다', async () => {
    const fn = stub({ requestId: 'r1', strategy: 'SIMILAR_V1', items: [] });
    await fetchSimilarSongs(12, { difficulty: 'HARD', size: 5 });
    const url = new URL(String(fn.mock.calls[0][0]), 'http://x');
    expect(url.pathname).toBe('/api/v1/songs/12/similar');
    expect(Object.fromEntries(url.searchParams)).toEqual({ difficulty: 'HARD', size: '5' });
  });

  it('옵션이 없으면 쿼리가 없다', async () => {
    const fn = stub({ requestId: 'r1', strategy: 's', items: [] });
    await fetchSimilarSongs(3);
    expect(String(fn.mock.calls[0][0])).not.toContain('?');
  });

  it('응답을 SimilarPage로 바꾼다', async () => {
    stub({ requestId: 'r1', strategy: 'SIMILAR_V1', items: [{ song: songDto, chartId: 34, difficulty: 'EASY', similarity: 0.9, matchedOn: ['RHYTHM'] }] });
    const page = await fetchSimilarSongs(1);
    expect(page.requestId).toBe('r1');
    expect(page.strategy).toBe('SIMILAR_V1');
    expect(page.items[0]).toMatchObject({ chartId: 34, similarity: 0.9, matchedOn: ['RHYTHM'] });
  });

  it('빈 items', async () => {
    stub({ requestId: 'r1', strategy: 's' });
    expect((await fetchSimilarSongs(1)).items).toEqual([]);
  });

  it('404는 ApiError로 던진다', async () => {
    stub({ code: 'SONG_NOT_FOUND', message: 'x' }, 404);
    await expect(fetchSimilarSongs(1)).rejects.toBeInstanceOf(ApiError);
  });
});
