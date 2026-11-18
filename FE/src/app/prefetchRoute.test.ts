// 메뉴 미리 받기 (설계 TECH-351 3절)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listPlays } from '@/api/play/plays';
import { listSheets } from '@/features/studio/api/sheets';
import { listAllSongs } from '@/api/song/songs';
import type { UserMe } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { useShellStore } from '@/store/shellStore';
import { useSongs } from '@/store/songStore';
import { queryClient } from '@/runtime/queryClient';
import { canPrefetch, prefetchRoute } from './prefetchRoute';
import { loadRoute } from './routeModules';

vi.mock('./routeModules', () => ({ loadRoute: vi.fn(() => Promise.resolve({ default: () => null })) }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), listAllSongs: vi.fn() }));
vi.mock('@/features/studio/api/sheets', async (orig) => ({ ...(await orig<typeof import('@/features/studio/api/sheets')>()), listSheets: vi.fn() }));
vi.mock('@/api/play/plays', async (orig) => ({ ...(await orig<typeof import('@/api/play/plays')>()), listPlays: vi.fn() }));

const setConnection = (c: object | undefined) => Object.defineProperty(navigator, 'connection', { value: c, configurable: true });
const metronome = useLive.getState().metronome;

beforeEach(() => {
  queryClient.clear();
  vi.mocked(loadRoute).mockClear();
  vi.mocked(listAllSongs).mockReset().mockResolvedValue([]);
  vi.mocked(listSheets).mockReset().mockResolvedValue({ items: [], hasNext: false });
  vi.mocked(listPlays).mockReset().mockResolvedValue({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0, hasNext: false });
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
  useSongs.setState({ source: 'api', scope: 'BUILTIN' });
  useShellStore.setState({ immersive: false });
  setConnection(undefined);
});
afterEach(() => {
  useAuth.setState({ status: 'unknown', user: null });
  useLive.setState({ metronome });
  setConnection(undefined);
});

describe('canPrefetch', () => {
  it('로그인 상태이고 연주 중이 아니면 허용(connection 없는 브라우저 포함)', () => {
    expect(canPrefetch()).toBe(true);
  });
  it('비로그인·연주 화면·메트로놈 재생·데이터 절약·2G 이하는 막는다', () => {
    useAuth.setState({ status: 'anonymous', user: null });
    expect(canPrefetch()).toBe(false);
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    useShellStore.setState({ immersive: true });
    expect(canPrefetch()).toBe(false);
    useShellStore.setState({ immersive: false });
    useLive.setState({ metronome: { ...metronome, playing: true } });
    expect(canPrefetch()).toBe(false);
    useLive.setState({ metronome });
    for (const c of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
      setConnection(c);
      expect(canPrefetch()).toBe(false);
    }
    setConnection({ effectiveType: '4g', saveData: false });
    expect(canPrefetch()).toBe(true);
  });
});

describe('prefetchRoute', () => {
  it('라이브러리: 화면 코드와 내 곡·악보 목록을 받는다', async () => {
    prefetchRoute('/studio');
    expect(loadRoute).toHaveBeenCalledWith('studio');
    await vi.waitFor(() => expect(listSheets).toHaveBeenCalled());
    expect(vi.mocked(listAllSongs).mock.calls[0][0]).toMatchObject({ source: 'MINE' });
  });
  it('곡 선택: 마지막 탭·플레이 후보 조건으로 곡 목록을 받는다', async () => {
    useSongs.setState({ scope: 'MINE' });
    prefetchRoute('/sheet');
    expect(loadRoute).toHaveBeenCalledWith('sheet');
    await vi.waitFor(() => expect(listAllSongs).toHaveBeenCalled());
    expect(vi.mocked(listAllSongs).mock.calls[0][0]).toMatchObject({ source: 'MINE', playableOnly: true });
  });
  it('연주 기록: 기본 조건의 첫 쪽만 받고, 30초 안 두 번째 미리 받기는 요청하지 않는다', async () => {
    prefetchRoute('/history');
    await vi.waitFor(() => expect(listPlays).toHaveBeenCalledTimes(1));
    expect(vi.mocked(listPlays).mock.calls[0][0]).toEqual({ sort: 'NEWEST', size: 20, page: 0 });
    prefetchRoute('/history');
    await Promise.resolve();
    expect(listPlays).toHaveBeenCalledTimes(1);
  });
  it('금지 조건이면 화면 코드도 데이터도 받지 않는다', () => {
    useShellStore.setState({ immersive: true });
    prefetchRoute('/studio');
    expect(loadRoute).not.toHaveBeenCalled();
    expect(listAllSongs).not.toHaveBeenCalled();
  });
});
