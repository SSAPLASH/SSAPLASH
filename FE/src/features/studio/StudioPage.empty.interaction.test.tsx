// @vitest-environment happy-dom
// 라이브러리 빈 화면(설계 QA-studio-empty-state): 곡·악보가 없으면 본문 업로드 양식 없이 같은 틀에 빈 안내만, 항목이 생기면 사라진다
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSheets } from '@/features/studio/api/sheets';
import { listAllSongs } from '@/api/song/songs';
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';
import type { SongSummary } from '@/domain/song/songCatalog';
import { useChartJob } from '@/store/chartJobStore';
import { useMidiUpload } from '@/features/studio/store/midiUploadStore';
import { useSongs } from '@/store/songStore';
import { queryClient } from '@/runtime/queryClient';
import { StudioPage } from './StudioPage';

vi.mock('@/features/studio/api/sheets', () => ({ listSheets: vi.fn(), linkSheetToSong: vi.fn(), deleteSheet: vi.fn(), updateSheetTitle: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), listAllSongs: vi.fn() }));

const HINT = '나만의 곡과 악보를 추가해 봐요!';

const song: SongSummary = {
  id: 1,
  title: '별빛 산책',
  artist: '파란물결',
  source: 'MIDI',
  status: 'READY',
  bpm: 120,
  timeSignature: '4/4',
  durationMs: 60000,
  hasAccompaniment: false,
  accompanimentStatus: 'NONE',
  songLevel: null,
  difficulties: [],
  createdAt: '2026-11-01T01:00:00Z',
  coverUrl: null,
  sheetId: null,
};
const sheet: SheetSummary = { id: 10, title: '합주 악보', kind: 'IMAGE', pageCount: 3, thumbnailUrl: null, createdAt: '2026-11-01T01:00:00Z', songId: null };

function renderPage() {
  return render(
    <MemoryRouter>
      <StudioPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(listAllSongs).mockReset().mockResolvedValue([]);
  vi.mocked(listSheets).mockReset().mockResolvedValue({ items: [], hasNext: false });
});
afterEach(() => {
  cleanup();
  useMidiUpload.getState().reset();
  useChartJob.setState({ phase: 'idle', active: null, error: null, progress: null });
  // 곡·악보 목록은 앱 전역 캐시다. 테스트마다 비운다
  queryClient.clear();
  useSongs.setState({ scope: 'MINE' });
});

describe('라이브러리 빈 화면', () => {
  it('곡·악보가 없으면 본문 업로드 양식 없이 빈 안내와 헤더 [올리기] 하나', async () => {
    renderPage();
    expect(await screen.findByText(HINT)).toBeTruthy();
    expect(document.querySelector('.studio-empty.card')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '올리기' })).toHaveLength(1);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(/처리 중 → 실패 → 완료/)).toBeNull();
    expect(screen.getByText('곡 0개')).toBeTruthy();
  });

  it('목록 보기로 바꾸면 목록 틀 안내로 바뀐다', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(HINT);
    await user.click(screen.getByRole('radio', { name: '목록' }));
    expect(document.querySelector('.studio-empty.list')).toBeTruthy();
    expect(document.querySelector('.studio-empty.card')).toBeNull();
  });

  it('곡이 있으면 안내가 없고, 요약은 제목 옆 작은 글씨이며 정렬 안내는 없다', async () => {
    vi.mocked(listAllSongs).mockResolvedValue([song]);
    renderPage();
    expect(await screen.findByText('별빛 산책')).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByText('곡 1개').className).toBe('ui-page-meta');
    expect(screen.getByRole('heading', { level: 2, name: '라이브러리' })).toBeTruthy();
    expect(screen.queryByText(/처리 중 → 실패 → 완료/)).toBeNull();
  });

  it('악보만 있어도 안내가 없다', async () => {
    vi.mocked(listSheets).mockResolvedValue({ items: [sheet], hasNext: false });
    renderPage();
    expect(await screen.findByText('합주 악보')).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('악보 목록을 읽는 동안에는 안내를 띄우지 않는다', async () => {
    let resolve: (v: { items: SheetSummary[]; hasNext: boolean }) => void = () => {};
    vi.mocked(listSheets).mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    // 곡 목록 읽기가 끝날 때까지 기다린다
    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: ['songs', 'list'], exact: false })?.state.status).toBe('success'));
    expect(screen.queryByText(HINT)).toBeNull();
    resolve({ items: [], hasNext: false });
    expect(await screen.findByText(HINT)).toBeTruthy();
  });

  it('헤더 [올리기]는 빈 상태에서도 마지막 섹션(기본 음원·MIDI)으로 연다', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(HINT);
    await user.click(screen.getByRole('button', { name: '올리기' }));
    expect(screen.getByRole('radio', { name: '음원·MIDI' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('음원 파일을 여기에 끌어다 놓으세요')).toBeTruthy();
  });
});

describe('라이브러리 목록 캐시 (설계 TECH-351)', () => {
  it('다시 들어오면 30초 안에는 곡·악보 목록을 다시 요청하지 않는다', async () => {
    renderPage();
    expect(await screen.findByText(HINT)).toBeTruthy();
    expect(listAllSongs).toHaveBeenCalledTimes(1);
    expect(listSheets).toHaveBeenCalledTimes(1);
    cleanup();
    renderPage();
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(listAllSongs).toHaveBeenCalledTimes(1);
    expect(listSheets).toHaveBeenCalledTimes(1);
  });
});

describe('악보 목록만 실패', () => {
  it('곡은 그대로 두고 [카드|목록]과 같은 줄에 한 줄 오류와 [다시 시도]를 보인다', async () => {
    vi.mocked(listAllSongs).mockResolvedValue([song]);
    vi.mocked(listSheets).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ items: [sheet], hasNext: false });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('별빛 산책')).toBeTruthy();
    const line = await screen.findByRole('alert');
    expect(line.textContent).toContain('악보를 불러오지 못했어요');
    // 보기 전환 줄 안에 있다
    expect(line.closest('.studio-toolbar')?.querySelector('[role="radiogroup"]')).toBeTruthy();
    await user.click(within(line).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('합주 악보')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
