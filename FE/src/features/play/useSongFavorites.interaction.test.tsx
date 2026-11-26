// @vitest-environment happy-dom
// 서버 저장을 켠 경우(FAVORITES_REMOTE=true)의 즐겨찾기 훅: 즉시 반영, 실패 시 되돌림, 연속 누름 처리.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addFavoriteSong, listFavoriteSongIds, removeFavoriteSong } from '@/api/song/favorites';
import { queryClient } from '@/runtime/queryClient';
import { useAuth } from '@/store/authStore';
import { useSongFavorites } from './useSongFavorites';

vi.mock('@/config/favorites', () => ({ FAVORITES_REMOTE: true }));
vi.mock('@/api/song/favorites', () => ({ listFavoriteSongIds: vi.fn(), addFavoriteSong: vi.fn(), removeFavoriteSong: vi.fn() }));

const ids = (r: { current: { ids: ReadonlySet<number> } }) => [...r.current.ids].sort((a, b) => a - b);

beforeEach(() => {
  queryClient.clear();
  localStorage.clear();
  vi.mocked(listFavoriteSongIds).mockReset().mockResolvedValue([1, 2]);
  vi.mocked(addFavoriteSong).mockReset().mockResolvedValue(undefined);
  vi.mocked(removeFavoriteSong).mockReset().mockResolvedValue(undefined);
  useAuth.setState({ status: 'authenticated' });
});
afterEach(cleanup);

describe('useSongFavorites (서버 저장)', () => {
  it('서버 목록을 읽고, 별을 누르면 응답 전에 바뀐다', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSongFavorites('api', onError));
    await waitFor(() => expect(ids(result)).toEqual([1, 2]));

    let release: () => void = () => {};
    vi.mocked(addFavoriteSong).mockReturnValue(new Promise<void>((r) => (release = r)));
    act(() => result.current.toggle(5));
    // 응답(release)을 기다리지 않고 바뀐다
    await waitFor(() => expect(ids(result)).toEqual([1, 2, 5]));
    expect(addFavoriteSong).toHaveBeenCalledWith(5);

    vi.mocked(listFavoriteSongIds).mockResolvedValue([1, 2, 5]);
    await act(async () => release());
    await waitFor(() => expect(listFavoriteSongIds).toHaveBeenCalledTimes(2));
    expect(ids(result)).toEqual([1, 2, 5]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('저장에 실패하면 원래대로 되돌리고 onError를 부른다', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSongFavorites('api', onError));
    await waitFor(() => expect(ids(result)).toEqual([1, 2]));

    let fail: (e: Error) => void = () => {};
    vi.mocked(removeFavoriteSong).mockReturnValue(new Promise<void>((_, reject) => (fail = reject)));
    act(() => result.current.toggle(2));
    await waitFor(() => expect(ids(result)).toEqual([1]));
    await act(async () => fail(new Error('fail')));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ids(result)).toEqual([1, 2]));
  });

  it('저장 중에 다시 누르면 끝난 뒤 마지막 상태로 한 번 더 맞춘다', async () => {
    const { result } = renderHook(() => useSongFavorites('api', vi.fn()));
    await waitFor(() => expect(ids(result)).toEqual([1, 2]));

    let release: () => void = () => {};
    vi.mocked(addFavoriteSong).mockReturnValue(new Promise<void>((r) => (release = r)));
    act(() => result.current.toggle(7));
    act(() => result.current.toggle(7));
    expect(ids(result)).toEqual([1, 2]);
    expect(removeFavoriteSong).not.toHaveBeenCalled();

    await act(async () => release());
    await waitFor(() => expect(removeFavoriteSong).toHaveBeenCalledWith(7));
    expect(addFavoriteSong).toHaveBeenCalledTimes(1);
  });

  it('로그인 전에는 목록을 읽지 않는다', () => {
    useAuth.setState({ status: 'anonymous' });
    renderHook(() => useSongFavorites('api', vi.fn()));
    expect(listFavoriteSongIds).not.toHaveBeenCalled();
  });

  it('내장 곡 소스는 서버를 부르지 않고 브라우저에 저장한다', async () => {
    const { result } = renderHook(() => useSongFavorites('builtin', vi.fn()));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggle(9));
    await waitFor(() => expect(ids(result)).toEqual([9]));
    expect(localStorage.getItem('ssaplash.favorites')).toBe('[9]');
    expect(listFavoriteSongIds).not.toHaveBeenCalled();
    expect(addFavoriteSong).not.toHaveBeenCalled();
  });
});
