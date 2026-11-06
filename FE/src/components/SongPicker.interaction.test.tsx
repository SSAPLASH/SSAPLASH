// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/recommendations';
import { getSong, listSongs } from '@/api/songs';
import type { RecommendationItem } from '@/domain/recommendation';
import type { SongSummary } from '@/domain/songCatalog';
import { useAuth } from '@/store/authStore';
import { useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import { SongPicker } from './SongPicker';
import { getBestRecords } from '@/api/plays';
import type { UserMe } from '@/domain/auth';

vi.mock('@/api/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/songs', () => ({ listSongs: vi.fn(), getSong: vi.fn() }));
vi.mock('@/api/plays', () => ({ getBestRecords: vi.fn() }));

const song = (id: number, title: string): SongSummary => ({
  id, title, artist: `가수${id}`, source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null,
});
const recoItem: RecommendationItem = {
  song: song(77, '추천곡'), chartId: 555, difficulty: 'EASY', reasons: [{ code: 'STARTER', text: 'BE 문구' }],
};

function show(onSelect = vi.fn()) {
  render(
    <MemoryRouter>
      <SongPicker onSelect={onSelect} mode="play" />
    </MemoryRouter>,
  );
  return onSelect;
}

beforeEach(() => {
  vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(listSongs).mockReset().mockResolvedValue({ items: [song(1, '목록곡')], hasNext: false });
  vi.mocked(getSong).mockReset().mockRejectedValue(new Error('no'));
  vi.mocked(fetchRecommendations).mockReset().mockResolvedValue({ requestId: 'r1', strategy: 's', items: [recoItem] });
  vi.mocked(postRecommendationClick).mockReset().mockResolvedValue(undefined);
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api', scope: 'BUILTIN', items: [], status: 'idle', error: null });
});

describe('SongPicker 서버 최고 기록', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    vi.mocked(getSong).mockResolvedValue({ ...song(1, '목록곡'), license: null, updatedAt: null, charts: [{ id: 11, difficulty: 'EASY', chartVersionId: 111, version: 1, noteCount: 5, notationStatus: 'READY' }] });
  });
  it.each(['play', 'sheet'] as const)('%s의 모드별 최고값을 표와 상세에 표시한다', async (mode) => {
    vi.mocked(getBestRecords).mockResolvedValue({ items: [
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: 'RHYTHM', bestScore: 321, bestAccuracy: 98 },
      { songId: 1, chartId: 12, difficulty: 'HARD', mode: 'RHYTHM', bestScore: 654, bestAccuracy: 80 },
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: 'SHEET', bestScore: null, bestAccuracy: 76.54 },
    ] });
    render(<MemoryRouter><SongPicker mode={mode} onSelect={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(mode === 'play' ? '654' : '76.5%').length).toBe(2));
    expect(getBestRecords).toHaveBeenCalledWith([1], expect.any(AbortSignal));
  });
  it('실패 중에도 준비 진입이 가능하고 재시도 뒤 0점이 표시된다', async () => {
    vi.mocked(getBestRecords).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: 'RHYTHM', bestScore: 0, bestAccuracy: 0 },
    ] });
    const onSelect = show();
    await screen.findByText('최고 기록을 불러오지 못했어요.');
    fireEvent.click(screen.getByRole('button', { name: '준비' }));
    expect(onSelect).toHaveBeenCalledWith(1, 11);
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.getAllByText('0').length).toBe(2));
    expect(screen.queryByText('최고 기록을 불러오지 못했어요.')).toBeNull();
  });
});
afterEach(() => {
  cleanup();
  useAuth.setState({ status: 'unknown', user: null });
});

describe('SongPicker 추천 줄', () => {
  it('카드를 누르면 onSelect(song.id, chartId)를 부르고 클릭 기록을 보낸다', async () => {
    const onSelect = show();
    const card = await screen.findByRole('button', { name: /추천곡/ });
    expect(screen.getByText('처음 시작하기 좋은 쉬운 곡이에요')).toBeTruthy();
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(77, 555);
    expect(postRecommendationClick).toHaveBeenCalledWith('r1', 77);
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchRecommendations).mock.calls[0][0]).toEqual({ context: 'SONG_PICKER', mode: 'RHYTHM', size: 5 });
  });

  it('라이브러리 탭에서는 숨고 기본 곡 탭으로 돌아오면 재요청 없이 다시 보인다', async () => {
    show();
    await screen.findByRole('region', { name: '추천곡' });
    fireEvent.click(screen.getByRole('radio', { name: '라이브러리' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '추천곡' })).toBeNull());
    fireEvent.click(screen.getByRole('radio', { name: '기본 곡' }));
    await screen.findByRole('region', { name: '추천곡' });
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
  });

  it('내장 곡 소스면 요청도 줄도 없다', async () => {
    useSongs.setState({ source: 'builtin' });
    show();
    await screen.findByText('리듬에 맞춰 도전해요');
    expect(fetchRecommendations).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '추천곡' })).toBeNull();
  });

  it('로그인하지 않았으면 요청도 줄도 없다', async () => {
    useAuth.setState({ status: 'unknown' });
    show();
    await screen.findByText('리듬에 맞춰 도전해요');
    expect(fetchRecommendations).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '추천곡' })).toBeNull();
  });
});
