// @vitest-environment happy-dom
// 라이브러리 곡 재생바 연결 (설계 CHART-003 라이브러리 재생바 2절·4절): 페이지가 반주 훅 하나를 playback으로 묶어 목록에 내려보낸다.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSheets } from '@/features/studio/api/sheets';
import { listAllSongs } from '@/api/song/songs';
import { queryClient } from '@/runtime/queryClient';
import type { UseFreeAccompaniment } from '@/components/song/useFreeAccompaniment';
import { accompanimentBarView } from '@/domain/song/freeAccompaniment';
import type { SongSummary } from '@/domain/song/songCatalog';
import { useChartJob } from '@/store/chartJobStore';
import { useMidiUpload } from '@/features/studio/store/midiUploadStore';
import { useSongs } from '@/store/songStore';
import { StudioPage } from './StudioPage';

const NONE = accompanimentBarView({ pick: null, playerState: 'idle', positionMs: 0, durationMs: 0, errorText: null });
const playingView = (songId: number) =>
  accompanimentBarView({
    pick: { songId, title: '별빛 산책', artist: '파란물결', coverUrl: null },
    playerState: 'playing',
    positionMs: 5000,
    durationMs: 60000,
    errorText: null,
  });

const hook = vi.hoisted(() => ({ current: null as unknown as UseFreeAccompaniment }));
vi.mock('@/components/song/useFreeAccompaniment', () => ({ useFreeAccompaniment: () => hook.current }));
vi.mock('@/features/studio/api/sheets', () => ({ listSheets: vi.fn(), linkSheetToSong: vi.fn(), deleteSheet: vi.fn(), updateSheetTitle: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), listAllSongs: vi.fn() }));

const song = (over: Partial<SongSummary> = {}): SongSummary => ({
  id: 1,
  title: '별빛 산책',
  artist: '파란물결',
  source: 'AUDIO',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 60000,
  hasAccompaniment: true,
  accompanimentStatus: 'READY',
  songLevel: null,
  difficulties: [],
  createdAt: '2026-11-01T01:00:00Z',
  coverUrl: 'https://x/c.jpg',
  sheetId: null,
  ...over,
});

function fakeHook(over: Partial<UseFreeAccompaniment> = {}): UseFreeAccompaniment {
  return { view: NONE, pick: vi.fn(), pause: vi.fn(), resume: vi.fn(), seek: vi.fn(), off: vi.fn(), retry: vi.fn(), available: true, ...over };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <StudioPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  hook.current = fakeHook();
  vi.mocked(listAllSongs).mockReset().mockResolvedValue([song(), song({ id: 2, title: '둘째 곡', artist: '' })]);
  vi.mocked(listSheets).mockReset().mockResolvedValue({ items: [], hasNext: false });
});
afterEach(() => {
  cleanup();
  useMidiUpload.getState().reset();
  useChartJob.setState({ phase: 'idle', active: null, error: null, progress: null });
  queryClient.clear();
  useSongs.setState({ scope: 'MINE' });
});

describe('라이브러리 곡 재생바 연결', () => {
  it('쉬는 재생바의 ▶는 그 곡의 id·제목·아티스트·커버로 훅 pick을 부른다(아티스트가 없으면 null)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '「별빛 산책」 반주 재생' }));
    expect(hook.current.pick).toHaveBeenCalledWith({ songId: 1, title: '별빛 산책', artist: '파란물결', coverUrl: 'https://x/c.jpg' });
    fireEvent.click(screen.getByRole('button', { name: '「둘째 곡」 반주 재생' }));
    expect(hook.current.pick).toHaveBeenLastCalledWith({ songId: 2, title: '둘째 곡', artist: null, coverUrl: 'https://x/c.jpg' });
  });

  it('재생 중: 그 곡의 재생바만 움직이고 조작이 훅으로 간다', async () => {
    hook.current = fakeHook({ view: playingView(1) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '「별빛 산책」 반주 일시정지' }));
    expect(hook.current.pause).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('slider', { name: '반주 위치' })).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('slider', { name: '반주 위치' }), { key: 'ArrowRight' });
    expect(hook.current.seek).toHaveBeenCalledWith(10_000);
    // 다른 곡의 ▶를 누르면 그 곡으로 바뀐다(이전 곡은 훅이 끈다)
    fireEvent.click(screen.getByRole('button', { name: '「둘째 곡」 반주 재생' }));
    expect(hook.current.pick).toHaveBeenCalledWith(expect.objectContaining({ songId: 2 }));
  });

  it('듣던 곡이 목록에 없으면(삭제) 끈다', async () => {
    hook.current = fakeHook({ view: playingView(99) });
    renderPage();
    await screen.findByRole('button', { name: '「별빛 산책」 반주 재생' });
    await waitFor(() => expect(hook.current.off).toHaveBeenCalled());
  });

  it('듣던 곡이 목록에 있으면 끄지 않는다', async () => {
    hook.current = fakeHook({ view: playingView(1) });
    renderPage();
    await screen.findByRole('button', { name: '「별빛 산책」 반주 일시정지' });
    expect(hook.current.off).not.toHaveBeenCalled();
  });

  it('반주를 쓸 수 없는 빌드(available=false)면 재생바·커버 재생 UI가 없다', async () => {
    hook.current = fakeHook({ available: false });
    renderPage();
    await screen.findByText('별빛 산책');
    expect(document.querySelector('.song-playbar')).toBeNull();
    expect(document.querySelector('.studio-cover-player')).toBeNull();
  });
});
