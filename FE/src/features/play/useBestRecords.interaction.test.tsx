// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { getBestRecords, type BestRecordsResponse } from '@/api/play/plays';
import { useAuth } from '@/store/authStore';
import { usePlaySync } from '@/runtime/playSync';
import { useBestRecords } from './useBestRecords';
import type { UserMe } from '@/domain/account/auth';
import type { PlayUploadState } from '@/domain/play/playLog';

vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
vi.mock('@/runtime/playSync', () => ({ usePlaySync: create(() => ({ states: {} })) }));
const response = (score: number): BestRecordsResponse => ({ items: [{ songId: 1, chartId: 11, difficulty: 'EASY', mode: 'RHYTHM', bestScore: score, bestAccuracy: 80 }] });
function deferred() {
  let resolve!: (value: BestRecordsResponse) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<BestRecordsResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.mocked(getBestRecords).mockReset().mockResolvedValue(response(100));
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
  usePlaySync.setState({ states: {} });
});
afterEach(cleanup);

describe('useBestRecords', () => {
  it('101곡을 100+1로 순차 조회하며 두 번째 묶음 실패는 전체 실패이고 재시도할 수 있다', async () => {
    const second = deferred();
    vi.mocked(getBestRecords).mockResolvedValueOnce(response(100)).mockReturnValueOnce(second.promise);
    const ids = [...Array.from({ length: 101 }, (_, i) => i + 1), 1, -1, 0];
    const { result } = renderHook(() => useBestRecords(ids, 'RHYTHM', true, 'api'));
    await waitFor(() => expect(getBestRecords).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getBestRecords).mock.calls.map(([songs]) => songs.length)).toEqual([100, 1]);
    expect(result.current.scoresBySong.size).toBe(0);
    await act(async () => second.reject(new Error('network')));
    expect(result.current.status).toBe('error');
    expect(result.current.scoresBySong.size).toBe(0);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.scoresBySong.get(1)).toBe(100);
  });
  it('인증 복원·익명·빈 목록·내장 소스는 요청하지 않는다', () => {
    useAuth.setState({ status: 'restoring' });
    const { rerender, result } = renderHook(({ ids, source }: { ids: number[]; source: 'api' | 'builtin' }) => useBestRecords(ids, 'RHYTHM', true, source), { initialProps: { ids: [1], source: 'api' } });
    expect(result.current.status).toBe('idle');
    act(() => useAuth.setState({ status: 'anonymous' }));
    rerender({ ids: [], source: 'api' });
    act(() => useAuth.setState({ status: 'authenticated' }));
    rerender({ ids: [-1], source: 'builtin' });
    expect(getBestRecords).not.toHaveBeenCalled();
  });
  it('계정 교체 뒤 이전 성공 응답과 로그아웃 뒤 늦은 오류를 버린다', async () => {
    const first = deferred(); const second = deferred();
    vi.mocked(getBestRecords).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useBestRecords([1], 'RHYTHM', true, 'api'));
    act(() => useAuth.setState({ user: { id: 2 } as UserMe }));
    expect(vi.mocked(getBestRecords).mock.calls[0][1].aborted).toBe(true);
    await act(async () => first.resolve(response(999)));
    expect(result.current.scoresBySong.size).toBe(0);
    act(() => useAuth.setState({ status: 'anonymous', user: null }));
    await act(async () => second.reject(new Error('late')));
    expect(result.current.status).toBe('idle');
    expect(result.current.scoresBySong.size).toBe(0);
  });
  it('곡 변경의 역순 응답과 unmount 응답을 버린다', async () => {
    const first = deferred();
    vi.mocked(getBestRecords).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ items: [] });
    const { result, rerender, unmount } = renderHook(({ id }) => useBestRecords([id], 'RHYTHM', true, 'api'), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => first.resolve(response(999)));
    expect(result.current.scoresBySong.size).toBe(0);
    unmount();
    expect(vi.mocked(getBestRecords).mock.calls[0][1].aborted).toBe(true);
  });
  it('같은 곡 단계 로딩에서는 성공값을 재사용하고 DONE 변화에서만 갱신한다', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useBestRecords([1], 'RHYTHM', enabled, 'api'), { initialProps: { enabled: true } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ enabled: false });
    expect(result.current.scoresBySong.size).toBe(0);
    rerender({ enabled: true });
    expect(getBestRecords).toHaveBeenCalledTimes(1);
    const state = (status: PlayUploadState['status']): PlayUploadState => ({ status, reason: null, retryable: false, attempts: 1, updatedAt: 'now' });
    for (const status of ['UPLOADING', 'FAILED', 'SKIPPED'] as const) act(() => usePlaySync.setState({ states: { play: state(status) } }));
    expect(getBestRecords).toHaveBeenCalledTimes(1);
    vi.mocked(getBestRecords).mockResolvedValue(response(200));
    act(() => usePlaySync.setState({ states: { play: state('DONE') } }));
    await waitFor(() => expect(result.current.scoresBySong.get(1)).toBe(200));
    act(() => usePlaySync.setState({ states: { play: state('DONE') } }));
    expect(getBestRecords).toHaveBeenCalledTimes(2);
    rerender({ enabled: false });
    act(() => usePlaySync.setState({ states: { play: { ...state('DONE'), updatedAt: 'later' } } }));
    expect(getBestRecords).toHaveBeenCalledTimes(2);
  });
});
