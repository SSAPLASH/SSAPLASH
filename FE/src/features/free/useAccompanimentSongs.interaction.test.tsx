// @vitest-environment happy-dom
// 반주 선택 창 목록 훅 (설계 MODE-002 3-8, D12). listSongs를 가짜로 주입한다.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongPage, SongSummary } from '@/domain/song/songCatalog';
import { MAX_FILL_PAGES, PAGE_SIZE, SEARCH_DEBOUNCE_MS, useAccompanimentSongs } from './useAccompanimentSongs';

const song = (id: number, acc: SongSummary['accompanimentStatus'] = 'READY'): SongSummary => ({
  id, title: `곡${id}`, artist: 'a', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 1000,
  hasAccompaniment: acc === 'READY', accompanimentStatus: acc, songLevel: null, difficulties: [], createdAt: '', coverUrl: null, sheetId: null,
});
const page = (items: SongSummary[], hasNext = false): SongPage => ({ items, hasNext });

const list = vi.fn();
const setup = () => renderHook(() => useAccompanimentSongs({ listSongs: list }));
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  list.mockReset().mockImplementation(async () => page([song(1)]));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useAccompanimentSongs', () => {
  it('열면 두 섹션 첫 페이지를 withAccompaniment·size로 받는다', async () => {
    const h = setup();
    expect(h.result.current.sections.builtin.status).toBe('loading');
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    const sources = list.mock.calls.map((c) => c[0].source).sort();
    expect(sources).toEqual(['BUILTIN', 'MINE']);
    expect(list.mock.calls[0][0]).toMatchObject({ page: 0, size: PAGE_SIZE, withAccompaniment: true });
    expect(h.result.current.sections.builtin).toMatchObject({ status: 'ready', hasMore: false });
    expect(h.result.current.sections.mine.items.map((x) => x.id)).toEqual([1]);
  });

  it('반주 없음·실패 곡은 거른다(생성 중은 남긴다)', async () => {
    list.mockImplementation(async () => page([song(1), song(2, 'NONE'), song(3, 'FAILED'), song(4, 'GENERATING')]));
    const h = setup();
    await flush();
    expect(h.result.current.sections.builtin.items.map((x) => x.id)).toEqual([1, 4]);
  });

  it('검색어는 300ms 디바운스 뒤 두 섹션을 1페이지부터 다시 받고 공백·100자를 정리한다', async () => {
    const h = setup();
    await flush();
    list.mockClear();
    act(() => h.result.current.setQuery('  드럼  '));
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 10); });
    expect(list).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toMatchObject({ q: '드럼', page: 0 });
    act(() => h.result.current.setQuery('가'.repeat(150)));
    expect(h.result.current.query).toHaveLength(100);
  });

  it('검색어가 바뀌면 이전 요청을 취소하고 늦게 온 응답은 버린다', async () => {
    let first!: (p: SongPage) => void;
    list.mockImplementationOnce(() => new Promise((r) => (first = r))).mockImplementationOnce(async () => page([]));
    const h = setup();
    await flush();
    const signal = list.mock.calls[0][1] as AbortSignal;
    act(() => h.result.current.setQuery('x'));
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10); });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      first(page([song(99)]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.result.current.sections.builtin.items.map((x) => x.id)).not.toContain(99);
  });

  it('D12: 거른 뒤 비었고 hasNext면 다음 페이지를 이어 받는다', async () => {
    list.mockImplementation(async (p: { source: string; page: number }) => {
      if (p.source === 'MINE') return page([]);
      return p.page === 0 ? page([song(2, 'NONE')], true) : page([song(5)], false);
    });
    const h = setup();
    await flush();
    const builtinCalls = list.mock.calls.filter((c) => c[0].source === 'BUILTIN');
    expect(builtinCalls.map((c) => c[0].page)).toEqual([0, 1]);
    expect(h.result.current.sections.builtin.items.map((x) => x.id)).toEqual([5]);
  });

  it('D12: 이어 받기는 최대 3페이지', async () => {
    list.mockImplementation(async (p: { source: string }) => page([song(2, 'NONE')], p.source === 'BUILTIN'));
    const h = setup();
    await flush();
    expect(list.mock.calls.filter((c) => c[0].source === 'BUILTIN')).toHaveLength(MAX_FILL_PAGES);
    expect(h.result.current.sections.builtin).toMatchObject({ status: 'ready', items: [], hasMore: true });
  });

  it('더 보기: 다음 페이지를 덧붙이고 중복은 버린다', async () => {
    list.mockImplementation(async (p: { source: string; page: number }) => {
      if (p.source === 'MINE') return page([]);
      return p.page === 0 ? page([song(1), song(2)], true) : page([song(2), song(3)], false);
    });
    const h = setup();
    await flush();
    expect(h.result.current.sections.builtin.hasMore).toBe(true);
    await act(async () => {
      h.result.current.sections.builtin.loadMore();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.result.current.sections.builtin.items.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(h.result.current.sections.builtin.hasMore).toBe(false);
  });

  it('한 섹션 실패가 다른 섹션을 막지 않고, 다시 시도로 복구된다', async () => {
    let fail = true;
    list.mockImplementation(async (p: { source: string }) => {
      if (p.source === 'MINE' && fail) throw new Error('boom');
      return page([song(1)]);
    });
    const h = setup();
    await flush();
    expect(h.result.current.sections.mine.status).toBe('error');
    expect(h.result.current.sections.builtin.status).toBe('ready');
    fail = false;
    await act(async () => {
      h.result.current.sections.mine.retry();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.result.current.sections.mine).toMatchObject({ status: 'ready' });
    expect(h.result.current.sections.mine.items).toHaveLength(1);
  });

  it('언마운트하면 진행 중 요청을 취소한다', async () => {
    list.mockImplementation(() => new Promise(() => {}));
    const h = setup();
    await flush();
    const signal = list.mock.calls[0][1] as AbortSignal;
    h.unmount();
    expect(signal.aborted).toBe(true);
  });
});
