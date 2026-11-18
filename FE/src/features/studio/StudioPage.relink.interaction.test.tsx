// @vitest-environment happy-dom
// 악보 나중 연결(D14~D17): 악보만 항목의 [곡 올리기] → 곡 등록 직후 PATCH 1회 → 목록 재조회·토스트, 실패 알림·[다시 연결]
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkSheetToSong, listSheets } from '@/features/studio/api/sheets';
import { listAllSongs, uploadMidi } from '@/api/song/songs';
import { SheetError, type SheetSummary } from '@/features/studio/domain/sheetMusic';
import type { SongDetail } from '@/domain/song/songCatalog';
import { useChartJob } from '@/store/chartJobStore';
import { useMidiUpload } from '@/features/studio/store/midiUploadStore';
import { useSheetLink } from '@/features/studio/store/sheetLinkStore';
import { useSongs } from '@/store/songStore';
import { queryClient } from '@/runtime/queryClient';
import { StudioPage } from './StudioPage';

vi.mock('@/features/studio/api/sheets', () => ({ listSheets: vi.fn(), linkSheetToSong: vi.fn(), deleteSheet: vi.fn(), updateSheetTitle: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), listAllSongs: vi.fn(), uploadMidi: vi.fn(), uploadMusicXml: vi.fn() }));

const sheet: SheetSummary = {
  id: 10,
  title: '합주 악보',
  kind: 'IMAGE',
  pageCount: 3,
  thumbnailUrl: null,
  createdAt: '2026-11-01T01:00:00Z',
  songId: null,
};
const midiSong = { id: 77, title: '합주 악보', artist: '', source: 'MIDI', status: 'READY', sheetId: null } as SongDetail;

function renderPage() {
  return render(
    <MemoryRouter>
      <StudioPage />
    </MemoryRouter>,
  );
}

async function openLinkDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '「합주 악보」 곡 올리기' }));
}

async function pickMidi(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'MIDI·MusicXML' }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['abc'], 'x.mid', { type: 'audio/midi' }));
}

beforeEach(() => {
  localStorage.clear();
  // songStore는 전체 페이지를 읽는 listAllSongs를 쓴다(Jira 363). listSongs만 mock하면 실제 요청이 나간다
  vi.mocked(listAllSongs).mockReset().mockResolvedValue([]);
  vi.mocked(listSheets).mockReset().mockResolvedValue({ items: [sheet], hasNext: false });
  vi.mocked(uploadMidi).mockReset().mockResolvedValue(midiSong);
  vi.mocked(linkSheetToSong).mockReset().mockResolvedValue({ ...sheet, songId: 77, pages: [], expiresAt: 0 });
});
afterEach(() => {
  cleanup();
  useSheetLink.getState().reset();
  useMidiUpload.getState().reset();
  useChartJob.setState({ phase: 'idle', active: null, error: null, progress: null });
  // 곡·악보 목록은 앱 전역 캐시다. 테스트마다 비운다
  queryClient.clear();
  useSongs.setState({ scope: 'MINE' });
});

describe('악보에 곡 올리기', () => {
  it('업로드 창이 「곡 올리기」로 섹션 전환 없이 열리고 안내·악보 제목 기본값이 있으며 다시 올리기 배너는 없다', async () => {
    const user = userEvent.setup();
    renderPage();
    await openLinkDialog(user);
    expect(screen.getByRole('heading', { name: '곡 올리기' })).toBeTruthy();
    expect(screen.getByText('「합주 악보」 악보에 연결돼요')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '악보' })).toBeNull();
    expect(screen.queryByText(/다시 올리기/)).toBeNull();
    expect((screen.getByLabelText(/곡 제목/) as HTMLInputElement).value).toBe('합주 악보');
  });

  it('MIDI 201 직후 PATCH {songId}를 한 번 보내고 목록을 다시 읽고 토스트를 보인다', async () => {
    const user = userEvent.setup();
    renderPage();
    await openLinkDialog(user);
    await pickMidi(user);
    await user.click(screen.getByRole('button', { name: '채보 만들기' }));
    await waitFor(() => expect(linkSheetToSong).toHaveBeenCalledTimes(1));
    expect(linkSheetToSong).toHaveBeenCalledWith(10, 77);
    expect(await screen.findByText('곡을 올리고 악보를 연결했어요')).toBeTruthy();
    expect(useSheetLink.getState()).toMatchObject({ target: null, pending: null });
    expect(vi.mocked(listSheets).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('PATCH가 실패하면 알림 줄과 [다시 연결]이 뜨고, [다시 연결]은 PATCH만 다시 보낸다(곡은 다시 올리지 않는다)', async () => {
    vi.mocked(linkSheetToSong).mockRejectedValueOnce(new SheetError('SHEET_UNAVAILABLE', 503));
    const user = userEvent.setup();
    renderPage();
    await openLinkDialog(user);
    await pickMidi(user);
    await user.click(screen.getByRole('button', { name: '채보 만들기' }));
    expect(await screen.findByText(/곡은 올렸지만 악보를 연결하지 못했어요/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '다시 연결' }));
    await waitFor(() => expect(linkSheetToSong).toHaveBeenCalledTimes(2));
    expect(vi.mocked(linkSheetToSong).mock.calls[1]).toEqual([10, 77]);
    expect(uploadMidi).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(/곡은 올렸지만/)).toBeNull());
    expect(await screen.findByText('곡을 올리고 악보를 연결했어요')).toBeTruthy();
  });

  it('음원은 202 직후(polling 진입) active.songId로 PATCH를 한 번 보낸다', async () => {
    const user = userEvent.setup();
    renderPage();
    await openLinkDialog(user);
    act(() => useChartJob.setState({ phase: 'uploading' }));
    act(() =>
      useChartJob.setState({
        phase: 'polling',
        active: { jobId: 5, songId: 55, title: '합주 악보', idempotencyKey: 'k', startedAt: '2026-11-09T00:00:00Z' },
      }),
    );
    await waitFor(() => expect(linkSheetToSong).toHaveBeenCalledWith(10, 55));
    expect(linkSheetToSong).toHaveBeenCalledTimes(1);
  });

  it('AUDIO_BUSY로 다른 생성 중 곡을 복구하면(jobId 없음) 그 곡에 연결하지 않고 대상 지정을 푼다', async () => {
    const user = userEvent.setup();
    renderPage();
    await openLinkDialog(user);
    act(() => useChartJob.setState({ phase: 'uploading' }));
    act(() =>
      useChartJob.setState({
        phase: 'polling',
        active: { jobId: null, songId: 99, title: '다른 곡', idempotencyKey: 'k', startedAt: '2026-11-09T00:00:00Z' },
      }),
    );
    await waitFor(() => expect(useSheetLink.getState().target).toBeNull());
    expect(linkSheetToSong).not.toHaveBeenCalled();
  });

  it('창을 닫으면 대상 지정이 풀려 곡이 등록돼도 연결하지 않는다', async () => {
    const user = userEvent.setup();
    renderPage();
    await openLinkDialog(user);
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(useSheetLink.getState().target).toBeNull();
    act(() => useChartJob.setState({ phase: 'uploading' }));
    act(() =>
      useChartJob.setState({
        phase: 'polling',
        active: { jobId: 5, songId: 55, title: 'x', idempotencyKey: 'k', startedAt: '2026-11-09T00:00:00Z' },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(linkSheetToSong).not.toHaveBeenCalled();
  });

  it('헤더 [올리기]로 열면 다시 일반 올리기 창(섹션 전환 있음)이다', async () => {
    const user = userEvent.setup();
    renderPage();
    await openLinkDialog(user);
    await user.click(screen.getByRole('button', { name: '닫기' }));
    await user.click(screen.getByRole('button', { name: '올리기' }));
    expect(screen.getByRole('radio', { name: '악보' })).toBeTruthy();
    expect(screen.queryByText(/악보에 연결돼요/)).toBeNull();
  });
});
