// songStore ↔ 곡 목록 캐시 연동 (설계 TECH-350 U1·U3)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllSongs } from '@/api/songs';
import { songKeys } from '@/api/queries/songs';
import { queryClient } from '@/app/queryClient';
import type { SongSummary } from '@/domain/songCatalog';
import { useSongs } from './songStore';

vi.mock('@/api/songs', async (orig) => ({ ...(await orig<typeof import('@/api/songs')>()), listAllSongs: vi.fn() }));

const song = (id: number, over: Partial<SongSummary> = {}): SongSummary => ({
  id, title: `곡${id}`, artist: '', source: 'MIDI', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 1000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null, sheetId: null,
  ...over,
});
const listKey = [...songKeys.list({ scope: 'MINE', playableOnly: true }), 'api'];

beforeEach(() => {
  queryClient.clear();
  vi.mocked(listAllSongs).mockReset().mockResolvedValue([song(1)]);
  useSongs.setState({ source: 'api', scope: 'BUILTIN', items: [], status: 'idle', error: null });
});

describe('songStore 곡 목록 캐시 연동', () => {
  it('내 곡을 다시 읽으면 곡 목록 캐시가 무효화된다', async () => {
    queryClient.setQueryData(listKey, [song(1)]);
    await useSongs.getState().load('MINE');
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
  });
  it('기본 곡 목록을 읽을 때는 무효화하지 않는다', async () => {
    queryClient.setQueryData(listKey, [song(1)]);
    await useSongs.getState().load('BUILTIN');
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  });
  it('patchItem은 store 목록과 캐시된 목록의 같은 곡 상태 필드를 함께 고친다', () => {
    useSongs.setState({ items: [song(1), song(2)] });
    queryClient.setQueryData(listKey, [song(1), song(2)]);
    useSongs.getState().patchItem(song(2, { hasAccompaniment: true, accompanimentStatus: 'READY', title: '바뀌면 안 됨' }));
    const cached = queryClient.getQueryData<SongSummary[]>(listKey)!;
    for (const list of [useSongs.getState().items, cached]) {
      expect(list[0]).toEqual(song(1));
      expect(list[1]).toMatchObject({ title: '곡2', hasAccompaniment: true, accompanimentStatus: 'READY' });
    }
  });
});
