// @vitest-environment happy-dom
// 리포트 하단 AI 추천 연습곡 (설계 COACH-004-song-recommend-report 4장). 요청 1회·파라미터·클릭 이동·숨김 조건.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/recommendations';
import { loadAllReportNotes, prefetchReport, refreshReport } from '@/app/playSync';
import type { RecommendationItem } from '@/domain/recommendation';
import type { Report } from '@/domain/report';
import type { SongSummary } from '@/domain/songCatalog';
import { useAuth } from '@/store/authStore';
import { useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import { ReportPage } from './ReportPage';

vi.mock('@/api/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/charts', () => ({ getChartAssets: vi.fn().mockResolvedValue({ accompanimentUrl: null }) }));
vi.mock('@/app/playSync', async (orig) => ({
  ...(await orig<typeof import('@/app/playSync')>()),
  prefetchReport: vi.fn(),
  refreshReport: vi.fn(),
  loadAllReportNotes: vi.fn(),
}));

const song: SongSummary = {
  id: 77, title: '추천곡', artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null,
};
const recoItem: RecommendationItem = { song, chartId: 555, difficulty: 'EASY', reasons: [{ code: 'WEAK_PAD', text: 'x' }] };
const report = (over: Partial<Report> = {}): Report => ({
  playId: 'p1', score: 1, accuracy: 0.5, maxCombo: 1, counts: { PERFECT: 1, GOOD: 0, MISS: 0 }, histogram: null, padStats: [],
  mode: 'RHYTHM', inputSource: 'KEYBOARD', analysisStatus: 'DONE', weakSegments: [], coachSummary: null, recommendedDrills: null,
  generatedAt: '', ...over,
});
const setReport = (r: Report | Error) =>
  vi.mocked(prefetchReport).mockReturnValue({ report: r instanceof Error ? Promise.reject(r) : Promise.resolve(r) } as ReturnType<typeof prefetchReport>);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
function show(path = '/result/p1/report') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/result/:playId/report" element={<ReportPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(prefetchReport).mockReset();
  setReport(report());
  vi.mocked(loadAllReportNotes).mockReset().mockResolvedValue([]);
  vi.mocked(refreshReport).mockReset().mockResolvedValue(report());
  vi.mocked(fetchRecommendations).mockReset().mockResolvedValue({ requestId: 'r1', strategy: 's', items: [recoItem] });
  vi.mocked(postRecommendationClick).mockReset().mockResolvedValue(undefined);
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api' });
});
afterEach(cleanup);

describe('리포트 하단 추천', () => {
  it('리포트 OK 뒤 REPORT 파라미터로 1회 요청하고 카드를 그린다', async () => {
    show();
    expect(await screen.findByText('AI 추천 연습곡')).toBeTruthy();
    expect(screen.getByText('추천곡')).toBeTruthy();
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchRecommendations).mock.calls[0][0]).toEqual({ context: 'REPORT', mode: 'RHYTHM', playId: 'p1', size: 5 });
  });

  it('분석 상태가 PENDING·FAILED여도 보인다', async () => {
    setReport(report({ analysisStatus: 'FAILED' }));
    show();
    expect(await screen.findByText('AI 추천 연습곡')).toBeTruthy();
  });

  it('SHEET 리포트는 mode=SHEET로 요청하고 /sheet로 이동한다', async () => {
    setReport(report({ mode: 'SHEET' }));
    show();
    fireEvent.click(await screen.findByText('추천곡'));
    expect(vi.mocked(fetchRecommendations).mock.calls[0][0].mode).toBe('SHEET');
    expect((await screen.findByTestId('where')).textContent).toBe('/sheet?song=77&chart=555');
  });

  it('카드 클릭은 기록을 보내고 /play?song=&chart=로 이동한다', async () => {
    show();
    fireEvent.click(await screen.findByText('추천곡'));
    expect(postRecommendationClick).toHaveBeenCalledWith('r1', 77);
    expect((await screen.findByTestId('where')).textContent).toBe('/play?song=77&chart=555');
  });

  it('[다시 시도]로 재마운트돼도 요청은 1회다', async () => {
    // 첫 노트 로드 실패 → 노트 카드의 [다시 시도]가 ReportView를 재마운트한다
    vi.mocked(loadAllReportNotes).mockRejectedValueOnce(new Error('x'));
    show();
    await screen.findByText('AI 추천 연습곡');
    fireEvent.click(await screen.findByText('다시 시도'));
    await waitFor(() => expect(prefetchReport).toHaveBeenCalledTimes(2));
    await screen.findByText('AI 추천 연습곡');
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
  });

  it('폴링으로 리포트가 바뀌어도 요청은 1회다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setReport(report({ analysisStatus: 'PENDING' }));
      vi.mocked(refreshReport).mockResolvedValue(report({ analysisStatus: 'DONE' }));
      show();
      await screen.findByText('AI 추천 연습곡');
      await vi.advanceTimersByTimeAsync(4500);
      expect(refreshReport).toHaveBeenCalled();
      expect(fetchRecommendations).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('리포트 로드 실패면 요청이 없다', async () => {
    setReport(Object.assign(new Error('x'), { status: 404 }));
    show();
    await screen.findByText(/불러오지|없습니다/);
    expect(fetchRecommendations).not.toHaveBeenCalled();
    expect(screen.queryByText('AI 추천 연습곡')).toBeNull();
  });

  it('내장 곡 빌드나 비인증이면 요청이 없다', async () => {
    useSongs.setState({ source: 'builtin' });
    show();
    await screen.findByText(/상세 분석/);
    await waitFor(() => expect(loadAllReportNotes).toHaveBeenCalled());
    cleanup();
    useSongs.setState({ source: 'api' });
    useAuth.setState({ status: 'anonymous' });
    show();
    await screen.findByText(/상세 분석/);
    expect(fetchRecommendations).not.toHaveBeenCalled();
  });

  it('추천이 비면 카드가 없다', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue({ requestId: 'r1', strategy: 's', items: [] });
    show();
    await waitFor(() => expect(fetchRecommendations).toHaveBeenCalled());
    expect(screen.queryByText('AI 추천 연습곡')).toBeNull();
  });
});
