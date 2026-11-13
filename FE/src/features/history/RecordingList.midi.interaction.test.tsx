// @vitest-environment happy-dom
// 녹음 보관함 ⋯ 메뉴의 「MIDI로 내보내기」 흐름 (설계 REC-002 3-7·4-1).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/error';
import { getRecording, listRecordings } from '@/api/play/recordings';
import type { RecordingDetail, RecordingSummary } from '@/domain/play/recording';
import { downloadBlob } from '@/features/history/media/downloadFile';
import { queryClient } from '@/runtime/queryClient';
import { RecordingList } from './RecordingList';

vi.mock('@/api/play/recordings');
vi.mock('@/features/history/media/downloadFile', () => ({ downloadBlob: vi.fn() }));
vi.mock('./recordingPlayer', () => ({
  recordingPlayer: { playing: false, onState: () => () => {}, stop: () => {}, play: vi.fn(), positionMs: () => 0 },
}));

const summary = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  id: 1,
  clientKey: 'k1',
  title: '내 연주',
  mode: 'FREE',
  inputSource: 'KEYBOARD',
  playId: null,
  hitCount: 2,
  durationMs: 5000,
  startedAt: '2026-11-03T05:05:00Z',
  createdAt: '2026-11-03T05:06:00Z',
  updatedAt: '2026-11-03T05:06:00Z',
  song: null,
  ...over,
});

const detail = (over: Partial<RecordingDetail> = {}): RecordingDetail => ({
  ...summary(),
  timing: null,
  hits: [
    { tMs: 100, pad: 'KICK', velocity: 100 },
    { tMs: 600, pad: 'SNARE', velocity: 90 },
  ],
  ...over,
});

const setList = (...items: RecordingSummary[]) =>
  vi.mocked(listRecordings).mockResolvedValue({ items, total: items.length, page: 0, size: 20, hasNext: false } as never);

async function openMenu(user: ReturnType<typeof userEvent.setup>, title = '내 연주') {
  await user.click(await screen.findByRole('button', { name: `${title} 메뉴` }));
}

beforeEach(() => {
  // 녹음 목록은 앱 전역 캐시다. 테스트마다 비운다
  queryClient.clear();
  vi.mocked(listRecordings).mockReset();
  vi.mocked(getRecording).mockReset();
  vi.mocked(downloadBlob).mockReset();
});
afterEach(cleanup);

describe('RecordingList MIDI 내보내기', () => {
  it('메뉴에서 「MIDI로 내보내기」가 「제목 변경」 위에 있다', async () => {
    setList(summary());
    const user = userEvent.setup();
    render(<RecordingList />);
    await openMenu(user);
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(labels).toEqual(['MIDI로 내보내기', '제목 변경', '삭제']);
  });

  it('hitCount 0이면 MIDI 항목이 없다', async () => {
    setList(summary({ hitCount: 0 }));
    const user = userEvent.setup();
    render(<RecordingList />);
    await openMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'MIDI로 내보내기' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '제목 변경' })).toBeTruthy();
  });

  it('성공: 내려받기와 success 토스트, 파일명은 제목 기반', async () => {
    setList(summary());
    vi.mocked(getRecording).mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<RecordingList />);
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI로 내보내기' }));
    await screen.findByText('MIDI 파일을 내려받았어요');
    expect(document.querySelector('.ui-toast-success')).not.toBeNull();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe('내 연주.mid');
    expect((blob as Blob).type).toBe('audio/midi');
    expect((blob as Blob).size).toBeGreaterThan(14);
  });

  it('곡 녹음인데 timing이 없으면 info 토스트(120 BPM)', async () => {
    setList(summary({ mode: 'RHYTHM', song: { songId: 7, title: '곡', difficulty: 'EASY' } }));
    vi.mocked(getRecording).mockResolvedValue(
      detail({ mode: 'RHYTHM', song: { songId: 7, title: '곡', difficulty: 'EASY' }, timing: null }),
    );
    const user = userEvent.setup();
    render(<RecordingList />);
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI로 내보내기' }));
    await screen.findByText('곡 빠르기 정보가 없어 120 BPM으로 내보냈어요');
    expect(document.querySelector('.ui-toast-info')).not.toBeNull();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it('조회 실패: 4xx면 서버 detail, 아니면 기본 문구. 내려받지 않는다', async () => {
    setList(summary());
    const user = userEvent.setup();
    render(<RecordingList />);

    vi.mocked(getRecording).mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', '볼 수 없는 녹음이에요'));
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI로 내보내기' }));
    await screen.findByText('볼 수 없는 녹음이에요');
    expect(document.querySelector('.ui-toast-error')).not.toBeNull();

    vi.mocked(getRecording).mockRejectedValueOnce(new ApiError(500, 'INTERNAL', '서버 오류'));
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI로 내보내기' }));
    await screen.findByText('녹음을 불러오지 못했어요');
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('내보내는 중 다시 눌러도 조회는 한 번', async () => {
    setList(summary());
    let resolve!: (d: RecordingDetail) => void;
    vi.mocked(getRecording).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<RecordingList />);
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI로 내보내기' }));
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI로 내보내기' }));
    expect(getRecording).toHaveBeenCalledTimes(1);
    resolve(detail());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    // 끝난 뒤에는 다시 내보낼 수 있다
    vi.mocked(getRecording).mockResolvedValue(detail());
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI로 내보내기' }));
    await waitFor(() => expect(getRecording).toHaveBeenCalledTimes(2));
  });
});
