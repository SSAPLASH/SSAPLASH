// @vitest-environment happy-dom
// 녹음 보관함 목록 캐시 (설계 TECH-351)
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listRecordings, type PageResponse } from '@/api/play/recordings';
import { recordingKeys } from '@/api/play/recordingQueries';
import { queryClient } from '@/runtime/queryClient';
import type { RecordingSummary } from '@/domain/play/recording';
import { useRecordingList } from './useRecordingList';

vi.mock('@/api/play/recordings', () => ({ listRecordings: vi.fn() }));

const rec = (id: number, title = `녹음 ${id}`): RecordingSummary => ({
  id, clientKey: `k${id}`, title, mode: 'FREE', inputSource: 'KEYBOARD', playId: null, hitCount: 10, durationMs: 1000,
  startedAt: '2026-11-03T05:00:00Z', createdAt: '2026-11-03T05:00:00Z', updatedAt: '2026-11-03T05:00:00Z', song: null,
});
const page = (n: number, ids: number[], hasNext: boolean): PageResponse<RecordingSummary> => ({
  items: ids.map((id) => rec(id)), page: n, size: 20, totalElements: 3, totalPages: 2, hasNext,
});
const query = { mode: 'ALL' as const, sort: 'NEWEST' as const, q: '' };

beforeEach(() => {
  queryClient.clear();
  vi.mocked(listRecordings).mockReset().mockImplementation(async (p) => (p?.page === 0 ? page(0, [1, 2], true) : page(1, [3], false)));
});

describe('useRecordingList 캐시', () => {
  it('[더 보기]로 이어 붙이고, 다시 마운트하면 요청 없이 바로 보인다', async () => {
    const first = renderHook(() => useRecordingList(query));
    await waitFor(() => expect(first.result.current.items).toHaveLength(2));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.items.map((i) => i.id)).toEqual([1, 2, 3]));
    first.unmount();
    const calls = vi.mocked(listRecordings).mock.calls.length;
    const again = renderHook(() => useRecordingList(query));
    expect(again.result.current.loading).toBe(false);
    expect(again.result.current.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(listRecordings).toHaveBeenCalledTimes(calls);
  });

  it('제목 변경·삭제는 캐시 행을 고치고 삭제는 total을 1 줄인다', async () => {
    const h = renderHook(() => useRecordingList(query));
    await waitFor(() => expect(h.result.current.items).toHaveLength(2));
    act(() => h.result.current.replaceItem(rec(2, '바뀐 제목')));
    // 캐시 변경 알림은 다음 틱에 묶여 온다
    await waitFor(() => expect(h.result.current.items[1].title).toBe('바뀐 제목'));
    act(() => h.result.current.removeItem(1));
    await waitFor(() => expect(h.result.current.items.map((i) => i.id)).toEqual([2]));
    expect(h.result.current.total).toBe(2);
    act(() => h.result.current.removeItem(99));
    await new Promise((r) => setTimeout(r, 10));
    expect(h.result.current.total).toBe(2);
  });

  it('reload는 이어 받은 쪽을 버리고 page 0부터 다시 읽는다', async () => {
    const h = renderHook(() => useRecordingList(query));
    await waitFor(() => expect(h.result.current.items).toHaveLength(2));
    act(() => h.result.current.loadMore());
    await waitFor(() => expect(h.result.current.items).toHaveLength(3));
    vi.mocked(listRecordings).mockClear();
    act(() => h.result.current.reload());
    await waitFor(() => expect(h.result.current.items).toHaveLength(2));
    expect(vi.mocked(listRecordings).mock.calls.map((c) => c[0]?.page)).toEqual([0]);
  });

  it('무효화되면 떠 있는 목록을 다시 받는다(업로드 성공 경로)', async () => {
    const h = renderHook(() => useRecordingList(query));
    await waitFor(() => expect(h.result.current.items).toHaveLength(2));
    vi.mocked(listRecordings).mockClear();
    await act(() => queryClient.invalidateQueries({ queryKey: recordingKeys.all }));
    expect(listRecordings).toHaveBeenCalled();
  });
});
