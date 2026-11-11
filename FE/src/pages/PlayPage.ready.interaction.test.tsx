// @vitest-environment happy-dom
// 연주 준비 비슷한 곡 페이지 통합 테스트 (설계 COACH-004-similar-songs 4-1). 실제 PlayPage를 그리고 api·loadChart만 mock한다.
// 준비 진입 곡당 1회 · 단계 변경 재요청 없음·배지 따라감 · 클릭 → 선택 단계 채보로 URL 변경 · 곡 변경 clear · builtin·404 숨김.
import { StrictMode, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/recommendations';
import { fetchSimilarSongs } from '@/api/similarSongs';
import { getSong } from '@/api/songs';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useRecommendations } from '@/store/recommendationStore';
import type { Difficulty, Chart } from '@/domain/chart';
import type { SongDetail, SongSummary } from '@/domain/songCatalog';
import { PlayPage } from '@/pages/PlayPage';

vi.mock('@/api/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));
vi.mock('@/api/songs', async (orig) => ({ ...(await orig<typeof import('@/api/songs')>()), getSong: vi.fn(), listSongs: vi.fn().mockResolvedValue({ items: [], hasNext: false }) }));
vi.mock('@/store/songStore', async (orig) => ({ ...(await orig<typeof import('@/store/songStore')>()), loadChart: vi.fn() }));

const sum = (id: number, d: Difficulty[]): SongSummary => ({
  id, title: `곡${id}`, artist: 'a', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 10000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: null, difficulties: d, createdAt: '', coverUrl: null, sheetId: null,
});
const CH: Record<number, { song: number; d: Difficulty }> = { 10: { song: 1, d: 'EASY' }, 11: { song: 1, d: 'NORMAL' }, 12: { song: 1, d: 'HARD' }, 51: { song: 5, d: 'EASY' }, 50: { song: 5, d: 'NORMAL' }, 60: { song: 6, d: 'HARD' } };
const detail = (id: number): SongDetail => ({
  ...sum(id, []), license: null, updatedAt: null,
  charts: Object.entries(CH).filter(([, v]) => v.song === id).map(([k, v]) => ({ id: Number(k), difficulty: v.d, chartVersionId: 1, version: 1, noteCount: 4 }) as never),
});
const chartOf = (songId: number, chartId: number): Chart => ({
  songId: String(songId), title: `곡${songId}`, difficulty: CH[chartId].d, bpm: 120, offsetMs: 0, beatsPerBar: 4,
  notes: [{ timeMs: 1000, pad: 'SNARE' as never }], source: 'MIDI', durationMs: 10000, chartId, songNumericId: songId, chartVersionId: 1,
});

function Where() { const l = useLocation(); return <div data-testid="where">{l.search}</div>; }
function show(path: string, page: ReactNode, strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Link to="/play">곡선택으로</Link>
      <Routes><Route path="/play" element={page} /><Route path="/sheet" element={page} /></Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  vi.mocked(loadChart).mockReset().mockImplementation(async ({ songId, chartId }) => ({ chart: chartOf(songId, chartId), assets: null }));
  vi.mocked(getSong).mockReset().mockImplementation(async (id: number) => detail(id));
  vi.mocked(fetchRecommendations).mockReset().mockResolvedValue({ requestId: 'r', strategy: 's', items: [] });
  vi.mocked(postRecommendationClick).mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchSimilarSongs).mockReset().mockImplementation(async (id: number) => ({
    requestId: `s${id}`, strategy: 'SIMILAR_V1',
    items: id === 1
      ? [
          { song: sum(5, ['EASY', 'NORMAL']), chartId: 50, difficulty: 'NORMAL', similarity: 0.9, matchedOn: ['RHYTHM'] },
          { song: sum(6, ['HARD']), chartId: 60, difficulty: 'HARD', similarity: 0.8, matchedOn: ['XYZ'] },
        ]
      : [{ song: sum(6, ['HARD']), chartId: 60, difficulty: 'HARD', similarity: 0.8, matchedOn: ['TEMPO'] }],
  }));
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api' });
});
afterEach(cleanup);

const section = () => document.querySelector('section[aria-label="이 곡과 비슷한 곡"]') as HTMLElement | null;

describe('연주 준비 비슷한 곡 (PlayPage 통합)', () => {
  it('진입 1회·단계 변경 재요청 없음·서버 배지와 채보 유지', async () => {
    show('/play?song=1&chart=11', <PlayPage />);
    await waitFor(() => expect(section()).not.toBeNull());
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchSimilarSongs).mock.calls[0].slice(0, 2)).toEqual([1, { difficulty: 'NORMAL', size: 5 }]);
    expect(section()!.textContent).toContain('리듬이 비슷해요');
    expect(section()!.textContent).not.toMatch(/0\.9|90/);
    const cards = () => section()!.querySelectorAll('.song-reco-card');
    expect(cards()[1].querySelector('.song-reco-reason')).toBeNull();
    // 연습 단계 EASY로
    const levels = screen.getByRole('group', { name: '연습 단계' });
    fireEvent.click(within(levels).getByText('EASY'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?song=1&chart=10'));
    await waitFor(() => expect(section()).not.toBeNull());
    await waitFor(() => expect(cards()[0].textContent).toContain('NORM'));
    expect(cards()[1].textContent).toContain('HARD');
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
    // 곡5 카드 클릭 → 응답 NORMAL 채보 50
    fireEvent.click(cards()[0]);
    expect(postRecommendationClick).toHaveBeenCalledWith('s1', 5);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?song=5&chart=50'));
    await waitFor(() => expect(fetchSimilarSongs).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchSimilarSongs).mock.calls[1].slice(0, 2)).toEqual([5, { difficulty: 'NORMAL', size: 5 }]);
    expect(useRecommendations.getState().entries['SIMILAR:1']).toBeUndefined();
    await waitFor(() => expect(section()?.textContent).toContain('템포가 비슷해요'));
    // 곡 선택으로 복귀 → clear
    await waitFor(() => expect(useRecommendations.getState().entries['SIMILAR:5']?.status).toBe('ready'));
    fireEvent.click(screen.getByText('곡선택으로'));
    await waitFor(() => expect(useRecommendations.getState().entries['SIMILAR:5']).toBeUndefined());
    expect(section()).toBeNull();
  });

  it('곡이 선택 단계를 갖지 않으면 BE chartId로, 상세 조회 실패면 BE chartId로', async () => {
    show('/play?song=1&chart=10', <PlayPage />);
    await waitFor(() => expect(section()).not.toBeNull());
    const cards = () => section()!.querySelectorAll('.song-reco-card');
    fireEvent.click(cards()[1]); // 곡6 HARD만 → BE 60
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?song=6&chart=60'));
  });

  it('상세 조회 실패 → BE chartId', async () => {
    show('/play?song=1&chart=10', <PlayPage />);
    await waitFor(() => expect(section()).not.toBeNull());
    vi.mocked(getSong).mockRejectedValue(new Error('x'));
    fireEvent.click(section()!.querySelectorAll('.song-reco-card')[0]);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?song=5&chart=50'));
  });

  it('StrictMode 1회 (PlayPage)', async () => {
    show('/play?song=1&chart=11', <PlayPage />, true);
    await waitFor(() => expect(section()).not.toBeNull());
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
  });

  it('builtin·비인증 → 요청 없음', async () => {
    useAuth.setState({ status: 'anonymous' } as never);
    show('/play?song=1&chart=11', <PlayPage />);
    await screen.findByRole('group', { name: '연습 단계' });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSimilarSongs).not.toHaveBeenCalled();
  });

  it('404·빈 items → 줄 없음, 오류 문구 없음', async () => {
    vi.mocked(fetchSimilarSongs).mockRejectedValue(Object.assign(new Error('곡 없음 SONG_NOT_FOUND'), { status: 404 }));
    show('/play?song=1&chart=11', <PlayPage />);
    await screen.findByRole('group', { name: '연습 단계' });
    await waitFor(() => expect(useRecommendations.getState().entries['SIMILAR:1']?.status).toBe('hidden'));
    expect(section()).toBeNull();
    expect(document.body.textContent).not.toContain('SONG_NOT_FOUND');
  });
});
