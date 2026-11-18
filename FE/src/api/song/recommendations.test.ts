import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { fetchRecommendations, postRecommendationClick } from './recommendations';

const songDto = {
  id: 12, title: '곡', artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 90000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null,
};

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => resetForTest('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('fetchRecommendations', () => {
  it('SONG_PICKER는 context·mode·size만 싣고 playId는 버린다', async () => {
    const fn = stub({ requestId: 'r1', strategy: 'RULE_R1', items: [] });
    await fetchRecommendations({ context: 'SONG_PICKER', mode: 'RHYTHM', size: 5, playId: 'p1' });
    const url = new URL(String(fn.mock.calls[0][0]), 'http://x');
    expect(url.pathname).toBe('/api/v1/songs/recommendations');
    expect(Object.fromEntries(url.searchParams)).toEqual({ context: 'SONG_PICKER', mode: 'RHYTHM', size: '5' });
  });

  it('REPORT는 playId를 싣는다', async () => {
    const fn = stub({ requestId: 'r1', strategy: 's', items: [] });
    await fetchRecommendations({ context: 'REPORT', mode: 'SHEET', playId: 'p1' });
    const url = new URL(String(fn.mock.calls[0][0]), 'http://x');
    expect(url.searchParams.get('playId')).toBe('p1');
    expect(url.searchParams.get('mode')).toBe('SHEET');
    expect(url.searchParams.has('size')).toBe(false);
  });

  it('DRILL은 playId와 size를 직렬화하고 focus를 보존한다', async () => {
    const fn = stub({ requestId: 'd', strategy: 'DRILL_V1', items: [{ song: songDto, chartId: 34, difficulty: 'HARD', reasons: [{ code: 'DRILL_TRANSITION', text: '그대로' }], focus: { pattern: 'TRANSITION', pads: ['SNARE', 'HIHAT'] } }] });
    const page = await fetchRecommendations({ context: 'DRILL', mode: 'SHEET', playId: 'p1', size: 3 });
    const url = new URL(String(fn.mock.calls[0][0]), 'http://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({ context: 'DRILL', mode: 'SHEET', size: '3', playId: 'p1' });
    expect(page.items[0].focus).toEqual({ pattern: 'TRANSITION', pads: ['SNARE', 'HIHAT'] });
  });

  it('응답을 RecommendationPage로 바꾼다(song 전체 필드)', async () => {
    stub({ requestId: 'r1', strategy: 'RULE_R1', items: [{ song: songDto, chartId: 34, difficulty: 'EASY', reasons: [{ code: 'STARTER', text: 't' }] }] });
    const page = await fetchRecommendations({ context: 'SONG_PICKER', mode: 'RHYTHM' });
    expect(page.requestId).toBe('r1');
    expect(page.strategy).toBe('RULE_R1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0].chartId).toBe(34);
    expect(page.items[0].song.songLevel).toBe('BEGINNER');
    expect(page.items[0].song.bpm).toBe(120);
  });

  it('빈 items', async () => {
    stub({ requestId: 'r1', strategy: 's', items: [] });
    expect((await fetchRecommendations({ context: 'SONG_PICKER', mode: 'RHYTHM' })).items).toEqual([]);
  });
});

describe('postRecommendationClick', () => {
  it('POST 본문은 { songId }', async () => {
    const fn = stub(null, 204);
    await postRecommendationClick('r1', 12);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/recommendations/r1/clicks');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ songId: 12 });
  });

  it('404는 ApiError로 던진다', async () => {
    stub({ code: 'RECOMMENDATION_NOT_FOUND', detail: 'x', status: 404 }, 404);
    await expect(postRecommendationClick('r1', 12)).rejects.toMatchObject({ status: 404 });
  });
});
