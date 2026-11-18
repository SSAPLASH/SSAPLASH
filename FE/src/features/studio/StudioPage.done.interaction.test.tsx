// @vitest-environment happy-dom
// 음원 채보가 끝나도 라이브러리에 머문다(QA): 악보 연습으로 이동하지 않고 목록을 다시 읽고 알림을 띄운다
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSheets } from '@/features/studio/api/sheets';
import { listAllSongs } from '@/api/song/songs';
import { useChartJob } from '@/store/chartJobStore';
import { useSongs } from '@/store/songStore';
import { queryClient } from '@/runtime/queryClient';
import { StudioPage } from './StudioPage';

vi.mock('@/features/studio/api/sheets', () => ({ listSheets: vi.fn(), linkSheetToSong: vi.fn(), deleteSheet: vi.fn(), updateSheetTitle: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), listAllSongs: vi.fn() }));

const job = { jobId: 5, songId: 42, title: '별빛 산책', idempotencyKey: 'k', startedAt: '2026-11-09T01:00:00Z' };

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/studio" element={<StudioPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <Where />
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
  useChartJob.setState({ phase: 'idle', active: null, error: null, progress: null, doneSource: null });
  // 곡·악보 목록은 앱 전역 캐시다. 테스트마다 비운다
  queryClient.clear();
  useSongs.setState({ scope: 'MINE' });
});

describe('음원 채보 완료', () => {
  it('지켜보던 중 끝나면 라이브러리에 머물고 알림을 띄운다', async () => {
    renderPage();
    await waitFor(() => expect(listAllSongs).toHaveBeenCalled());
    const calls = vi.mocked(listAllSongs).mock.calls.length;
    act(() => {
      useChartJob.setState({ phase: 'done', doneSource: 'live', active: job, error: null });
    });
    expect(await screen.findByText('「별빛 산책」 악보가 만들어졌어요')).toBeTruthy();
    expect(screen.getAllByTestId('where').map((e) => e.textContent)).toEqual(['/studio']);
    await waitFor(() => expect(vi.mocked(listAllSongs).mock.calls.length).toBeGreaterThan(calls));
    expect(useChartJob.getState().phase).toBe('idle');
  });
});
