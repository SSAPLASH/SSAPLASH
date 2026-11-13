// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import { getSong, listAllSongs, retryMidiAccompaniment } from '@/api/song/songs';
import type { SongSummary } from '@/domain/song/songCatalog';
import { listSheets } from '@/features/studio/api/sheets';
import { queryClient } from '@/runtime/queryClient';
import { useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { AccompanimentPoller } from './components/accompaniment/accompanimentPoller';
import { StudioPage } from './StudioPage';

vi.mock('@/features/studio/api/sheets', () => ({ listSheets: vi.fn(), linkSheetToSong: vi.fn(), deleteSheet: vi.fn(), updateSheetTitle: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), listAllSongs: vi.fn(), getSong: vi.fn(), retryMidiAccompaniment: vi.fn() }));

const song: SongSummary = { id: 7, title: '테스트 곡', artist: '', source: 'MIDI', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 60000, hasAccompaniment: false, accompanimentStatus: 'FAILED', songLevel: null, difficulties: [], createdAt: '2026-11-01T00:00:00Z', coverUrl: null, sheetId: null };
const detail = { ...song, accompanimentStatus: 'GENERATING' as const, charts: [], license: null, updatedAt: song.createdAt };
const show = () => render(<MemoryRouter><StudioPage /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  queryClient.clear();
  useSongs.setState({ source: 'api', scope: 'MINE' });
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as NonNullable<ReturnType<typeof useAuth.getState>['user']> });
  vi.mocked(listAllSongs).mockReset().mockResolvedValue([song]);
  vi.mocked(getSong).mockReset().mockResolvedValue(detail);
  vi.mocked(retryMidiAccompaniment).mockReset().mockResolvedValue(undefined);
  vi.mocked(listSheets).mockReset().mockResolvedValue({ items: [], hasNext: false });
});
afterEach(() => { cleanup(); queryClient.clear(); useAuth.setState({ status: 'unknown', user: null }); vi.restoreAllMocks(); });

describe('MIDI 반주 재시도', () => {
  it.each(['card', 'list'])('%s 보기에서 요청 중 중복 클릭을 막고 상태를 갱신한다', async (view) => {
    localStorage.setItem('airdrum.studio.view', view);
    let resolve!: () => void;
    vi.mocked(retryMidiAccompaniment).mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    show();
    const button = await screen.findByRole('button', { name: '반주 생성 다시 시도' });
    expect(button.textContent).toBe('반주 생성 실패');
    expect(button.getAttribute('title')).toBe('반주 생성 다시 시도');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(vi.mocked(retryMidiAccompaniment)).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve());
    expect(await screen.findByText('반주 생성 중')).toBeTruthy();
    expect(getSong).toHaveBeenCalledWith(7);
    expect(screen.getByText('반주 생성을 다시 시작했어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '반주 생성 다시 시도' })).toBeNull();
  });

  it('409는 상세를 다시 읽어 현재 생성 상태를 표시한다', async () => {
    vi.mocked(retryMidiAccompaniment).mockRejectedValue(new ApiError(409, 'MIDI_RETRY_UNAVAILABLE', '내부 정보'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: '반주 생성 다시 시도' }));
    expect(await screen.findByText('반주 생성 중')).toBeTruthy();
    expect(screen.getByText('이미 처리 중이거나 반주를 다시 만들 수 없어요')).toBeTruthy();
    expect(getSong).toHaveBeenCalledWith(7);
  });

  it('접수 후 상세 조회가 실패해도 폴링을 초기화하고 목록 재조회로 복구한다', async () => {
    const restart = vi.spyOn(AccompanimentPoller.prototype, 'restart');
    vi.mocked(getSong).mockRejectedValue(new ApiError(404, 'SONG_NOT_FOUND', '없음'));
    vi.mocked(listAllSongs).mockResolvedValueOnce([song]).mockResolvedValue([detail]);
    show();
    fireEvent.click(await screen.findByRole('button', { name: '반주 생성 다시 시도' }));
    expect(await screen.findByText('반주 재시도 요청은 접수됐지만 상태를 확인하지 못했어요')).toBeTruthy();
    await screen.findByText('반주 생성 중');
    expect(restart).toHaveBeenCalledWith(7);
  });

  it('요청 도중 계정이 바뀌면 이전 응답으로 새 계정 캐시를 덮지 않는다', async () => {
    let resolve!: () => void;
    vi.mocked(retryMidiAccompaniment).mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: '반주 생성 다시 시도' }));
    act(() => useAuth.setState({ status: 'authenticated', user: { id: 2 } as NonNullable<ReturnType<typeof useAuth.getState>['user']> }));
    await act(async () => resolve());
    expect(getSong).not.toHaveBeenCalled();
    expect(screen.queryByText('반주 생성을 다시 시작했어요')).toBeNull();
  });

  it.each([
    [401, 'UNAUTHORIZED', '다시 로그인해 주세요'],
    [404, 'SONG_NOT_FOUND', '곡을 찾을 수 없어요'],
    [503, 'MIDI_STORAGE_UNAVAILABLE', '반주 생성을 다시 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요'],
  ])('%i 오류를 안전한 문구로 표시한다', async (status, code, message) => {
    vi.mocked(retryMidiAccompaniment).mockRejectedValue(new ApiError(status, code, '내부 정보'));
    show();
    const button = await screen.findByRole('button', { name: '반주 생성 다시 시도' });
    fireEvent.click(button);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('내부 정보')).toBeNull();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it.each(['AUDIO', 'MUSICXML'] as const)('%s 실패 배지는 동작 버튼이 아니다', async (source) => {
    vi.mocked(listAllSongs).mockResolvedValue([{ ...song, source }]);
    show();
    expect(await screen.findByText('반주 생성 실패')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '반주 생성 다시 시도' })).toBeNull();
  });
});
