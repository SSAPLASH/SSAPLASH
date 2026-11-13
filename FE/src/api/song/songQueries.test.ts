// 곡 목록 쿼리 (설계 TECH-350·351). 옛 songStore.load·patchItem 테스트를 옮겼다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTest } from '@/api/account/auth';
import { createQueryClient } from '@/runtime/queryClient';
import { BUILTIN_CHARTS } from '@/domain/song/chart';
import type { SongSummary } from '@/domain/song/songCatalog';
import { mineSongsQuery, patchSongStatus, songListQuery } from './songQueries';

const song = (over: Partial<SongSummary> = {}): SongSummary => ({
  id: 7, title: '별빛 산책', artist: '', source: 'MIDI', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'GENERATING', songLevel: null, difficulties: ['EASY', 'NORMAL', 'HARD'],
  createdAt: '2026-11-03T00:00:00Z', coverUrl: 'https://x/c.jpg', sheetId: null, ...over,
});
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const qsOf = (fn: ReturnType<typeof vi.fn>, i = 0) => new URL(String(fn.mock.calls[i][0]), 'http://x').searchParams;

let client = createQueryClient();
beforeEach(() => {
  client = createQueryClient();
  resetForTest('tok');
});
afterEach(() => vi.unstubAllGlobals());

describe('patchSongStatus', () => {
  it('같은 id 곡의 상태 필드만 바꾸고 목록 전용 값은 그대로 둔다', () => {
    const [a, b] = patchSongStatus(
      [song(), song({ id: 8, title: '다른 곡' })],
      song({ accompanimentStatus: 'READY', hasAccompaniment: true, songLevel: 'ADVANCED', difficulties: [], coverUrl: null, title: '상세 제목' }),
    );
    expect(a).toMatchObject({ accompanimentStatus: 'READY', hasAccompaniment: true, songLevel: 'ADVANCED', difficulties: ['EASY', 'NORMAL', 'HARD'], coverUrl: 'https://x/c.jpg', title: '별빛 산책' });
    expect(b.accompanimentStatus).toBe('GENERATING');
  });
  it('목록에 없는 곡이면 그대로다', () => {
    const list = [song()];
    expect(patchSongStatus(list, song({ id: 99, accompanimentStatus: 'FAILED' }))).toEqual(list);
  });
});

describe('곡 목록 조건', () => {
  it('api 소스: 난이도·플레이 후보 조건을 목록 요청에 싣는다', async () => {
    const fn = vi.fn(async (_url: string) => ok({ items: [], hasNext: false }));
    vi.stubGlobal('fetch', fn);
    await client.fetchQuery(songListQuery({ scope: 'BUILTIN', songLevel: 'BEGINNER', playableOnly: true }, 'api'));
    expect(qsOf(fn).get('songLevel')).toBe('BEGINNER');
    expect(qsOf(fn).get('playableOnly')).toBe('true');
  });
  it('내 곡(라이브러리)은 조건 쿼리가 없다', async () => {
    const fn = vi.fn(async (_url: string) => ok({ items: [], hasNext: false }));
    vi.stubGlobal('fetch', fn);
    await client.fetchQuery(mineSongsQuery('api'));
    expect(qsOf(fn).get('source')).toBe('MINE');
    expect(qsOf(fn).has('songLevel')).toBe(false);
    expect(qsOf(fn).has('playableOnly')).toBe(false);
  });
  it('내장 소스: BE를 부르지 않고, 난이도 필터를 걸면 빈 목록(내장 곡은 난이도 없음), 내 곡은 없다', async () => {
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);
    const all = await client.fetchQuery(songListQuery({ scope: 'BUILTIN', playableOnly: true }, 'builtin'));
    expect(all).toHaveLength(BUILTIN_CHARTS.length);
    expect(all.every((s) => s.songLevel === null)).toBe(true);
    expect(await client.fetchQuery(songListQuery({ scope: 'BUILTIN', songLevel: 'BEGINNER' }, 'builtin'))).toEqual([]);
    expect(await client.fetchQuery(mineSongsQuery('builtin'))).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
  it('api 소스: 100곡을 넘으면 다음 페이지까지 모두 담는다 (Jira 363)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const p = Number(new URL(url, 'http://x').searchParams.get('page'));
      const ids = p === 0 ? Array.from({ length: 100 }, (_, i) => i + 1) : [101, 102];
      return ok({ items: ids.map((id) => ({ id, title: `곡${id}`, status: 'READY' })), hasNext: p === 0 });
    }));
    const items = await client.fetchQuery(songListQuery({ scope: 'BUILTIN' }, 'api'));
    expect(items).toHaveLength(102);
    expect(items.at(-1)?.id).toBe(102);
  });
});
