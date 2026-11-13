// @vitest-environment happy-dom
// 플레이 기록 쪽 단위 조회 (설계 COACH-연주-기록-화면-개편 4, TECH-351 캐시 규칙)
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listPlays, type PlaySummary } from '@/api/play/plays';
import { DEFAULT_PLAY_LIST, playKeys, playPageQuery } from '@/api/play/playQueries';
import type { PageResponse } from '@/api/play/recordings';
import { queryClient } from '@/runtime/queryClient';
import { usePlayLogList, type PlayLogQuery } from './usePlayLogList';

vi.mock('@/api/play/plays', () => ({ listPlays: vi.fn() }));

const play = (playId: string): PlaySummary => ({
  playId, startedAt: '2026-11-12T05:00:00Z', endedAt: '2026-11-12T05:01:00Z', mode: 'RHYTHM', inputSource: 'KEYBOARD', songId: 1, songTitle: '곡',
  chartVersionId: 1, chartId: 1, difficulty: 'NORMAL', endReason: 'COMPLETED', songAccessible: true, score: 100, accuracy: 50, maxCombo: 1, hasReport: true,
});
const page = (n: number, ids: string[], hasNext: boolean): PageResponse<PlaySummary> => ({
  items: ids.map(play), page: n, size: 20, totalElements: 3, totalPages: 2, hasNext,
});
const base: PlayLogQuery = { mode: 'ALL', period: 'ALL', sort: 'NEWEST', q: '' };

beforeEach(() => {
  queryClient.clear();
  vi.mocked(listPlays).mockReset().mockImplementation(async (p) => (p?.page === 0 ? page(0, ['a', 'b'], true) : page(1, ['c'], false)));
});

// 앞 테스트의 훅이 남아 있으면 캐시를 비울 때 다시 조회해 호출 수가 섞인다
afterEach(cleanup);

describe('usePlayLogList', () => {
  it('첫 쪽을 받고 [더 보기]로 이어 붙인다. 건수는 서버 전체 건수', async () => {
    const h = renderHook(() => usePlayLogList(1, base));
    expect(h.result.current.loading).toBe(true);
    await waitFor(() => expect(h.result.current.items.map((p) => p.playId)).toEqual(['a', 'b']));
    expect(h.result.current.total).toBe(3);
    expect(h.result.current.hasNext).toBe(true);
    act(() => h.result.current.loadMore());
    await waitFor(() => expect(h.result.current.items.map((p) => p.playId)).toEqual(['a', 'b', 'c']));
    expect(h.result.current.hasNext).toBe(false);
    expect(vi.mocked(listPlays).mock.calls.map((c) => c[0]?.page)).toEqual([0, 1]);
  });

  it('조건이 바뀌면 그 조건으로 첫 쪽부터 다시 받는다(모드·기간·정렬은 바로)', async () => {
    const h = renderHook(({ q }: { q: PlayLogQuery }) => usePlayLogList(1, q), { initialProps: { q: base } });
    await waitFor(() => expect(h.result.current.items).toHaveLength(2));
    h.rerender({ q: { ...base, mode: 'SHEET', sort: 'OLDEST', period: '7D' } });
    await waitFor(() => expect(vi.mocked(listPlays).mock.calls.length).toBe(2));
    const sent = vi.mocked(listPlays).mock.calls[1][0];
    expect(sent).toMatchObject({ mode: 'SHEET', sort: 'OLDEST', page: 0, size: 20 });
    expect(sent?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('검색어는 300ms 뒤에 보내고, 그동안 적용된 검색어는 이전 값이다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const h = renderHook(({ q }: { q: PlayLogQuery }) => usePlayLogList(1, q), { initialProps: { q: base } });
      await waitFor(() => expect(h.result.current.items).toHaveLength(2));
      h.rerender({ q: { ...base, q: '별' } });
      h.rerender({ q: { ...base, q: '별빛' } });
      expect(h.result.current.appliedQ).toBe('');
      expect(listPlays).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(300));
      await waitFor(() => expect(listPlays).toHaveBeenCalledTimes(2));
      expect(vi.mocked(listPlays).mock.calls[1][0]).toMatchObject({ q: '별빛', page: 0 });
      expect(h.result.current.appliedQ).toBe('별빛');
    } finally {
      vi.useRealTimers();
    }
  });

  it('로그인 사용자가 없으면 서버를 부르지 않는다', async () => {
    const h = renderHook(() => usePlayLogList(null, base));
    await new Promise((r) => setTimeout(r, 10));
    expect(listPlays).not.toHaveBeenCalled();
    expect(h.result.current.items).toEqual([]);
    expect(h.result.current.loading).toBe(false);
  });

  it('계정이 다르면 캐시를 나눠 쓴다', async () => {
    const a = renderHook(() => usePlayLogList(1, base));
    await waitFor(() => expect(a.result.current.items).toHaveLength(2));
    a.unmount();
    const b = renderHook(() => usePlayLogList(2, base));
    expect(b.result.current.items).toEqual([]);
    await waitFor(() => expect(listPlays).toHaveBeenCalledTimes(2));
  });

  it('메뉴 미리 받기(기본 조건 첫 쪽)와 같은 키를 써서 다시 받지 않는다', async () => {
    await queryClient.prefetchInfiniteQuery(playPageQuery(1, DEFAULT_PLAY_LIST));
    expect(listPlays).toHaveBeenCalledTimes(1);
    const h = renderHook(() => usePlayLogList(1, base));
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.items.map((p) => p.playId)).toEqual(['a', 'b']);
    expect(listPlays).toHaveBeenCalledTimes(1);
  });

  it('무효화되면 떠 있는 목록을 다시 받는다(업로드 완료 경로)', async () => {
    const h = renderHook(() => usePlayLogList(1, base));
    await waitFor(() => expect(h.result.current.items).toHaveLength(2));
    vi.mocked(listPlays).mockClear();
    await act(() => queryClient.invalidateQueries({ queryKey: playKeys.all }));
    expect(listPlays).toHaveBeenCalled();
  });

  it('실패하면 오류 문구를 주고 reload로 첫 쪽부터 다시 받는다', async () => {
    vi.mocked(listPlays).mockReset().mockRejectedValue(new Error('network'));
    const h = renderHook(() => usePlayLogList(1, base));
    await waitFor(() => expect(h.result.current.error).toBe('목록을 불러오지 못했어요'), { timeout: 4000 });
    vi.mocked(listPlays).mockReset().mockResolvedValue(page(0, ['a'], false));
    act(() => h.result.current.reload());
    await waitFor(() => expect(h.result.current.items.map((p) => p.playId)).toEqual(['a']));
    expect(h.result.current.error).toBeNull();
  });
});
