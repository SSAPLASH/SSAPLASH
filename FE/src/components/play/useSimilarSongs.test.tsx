// @vitest-environment happy-dom
// 연주 준비 비슷한 곡 훅 (설계 COACH-004-similar-songs D1·D2·D10·D11). 곡당 1회·단계 변경 재요청 없음·카드 단계 따라가기·클릭.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postRecommendationClick } from '@/api/recommendations';
import { fetchSimilarSongs } from '@/api/similarSongs';
import type { Difficulty } from '@/domain/chart';
import type { SongSummary } from '@/domain/songCatalog';
import { useAuth } from '@/store/authStore';
import { useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import { useSimilarSongs } from './useSimilarSongs';

vi.mock('@/api/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));

const song = (id: number, difficulties: Difficulty[]): SongSummary => ({
  id, title: `곡${id}`, artist: 'a', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 1000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: null, difficulties, createdAt: '', coverUrl: null, sheetId: null,
});

interface Props {
  songId: number | null;
  active: boolean;
  difficulty: Difficulty | null;
}
const selectSong = vi.fn();
const onSelect = vi.fn();

function setup(initial: Props, strict = false) {
  const wrapper = strict ? ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> : undefined;
  return renderHook((p: Props) => useSimilarSongs({ ...p, onSelect }), { initialProps: initial, wrapper });
}

beforeEach(() => {
  vi.mocked(fetchSimilarSongs).mockReset().mockResolvedValue({
    requestId: 'r1', strategy: 'SIMILAR_V1',
    items: [
      { song: song(5, ['EASY', 'NORMAL']), chartId: 50, difficulty: 'NORMAL', similarity: 0.9, matchedOn: ['RHYTHM'] },
      { song: song(6, ['HARD']), chartId: 60, difficulty: 'HARD', similarity: 0.8, matchedOn: [] },
    ],
  });
  vi.mocked(postRecommendationClick).mockReset().mockResolvedValue(undefined);
  selectSong.mockReset();
  onSelect.mockReset();
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api', selectSong });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('요청', () => {
  it('준비 단계에 들어오면 곡·난이도로 1회 요청하고 카드를 낸다', async () => {
    const { result } = setup({ songId: 1, active: true, difficulty: 'EASY' });
    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    expect(vi.mocked(fetchSimilarSongs).mock.calls[0].slice(0, 2)).toEqual([1, { difficulty: 'EASY', size: 5 }]);
  });

  it('준비 단계가 아니면 요청하지 않는다(채보 로딩 중)', async () => {
    const { result } = setup({ songId: 1, active: false, difficulty: null });
    await Promise.resolve();
    expect(fetchSimilarSongs).not.toHaveBeenCalled();
    expect(result.current.cards).toEqual([]);
  });

  it('연습 단계를 바꾸거나 잠깐 준비 단계를 벗어나도 재요청하지 않는다', async () => {
    const { result, rerender } = setup({ songId: 1, active: true, difficulty: 'EASY' });
    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    rerender({ songId: 1, active: false, difficulty: 'EASY' });
    rerender({ songId: 1, active: true, difficulty: 'HARD' });
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
  });

  it('StrictMode에서도 1회다', async () => {
    const { result } = setup({ songId: 1, active: true, difficulty: 'NORMAL' }, true);
    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
  });

  it('곡이 바뀌면 이전 키를 지우고 새로 1회 요청한다, 곡 선택(null)으로 돌아가면 지운다', async () => {
    const { result, rerender } = setup({ songId: 1, active: true, difficulty: 'EASY' });
    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    rerender({ songId: 2, active: false, difficulty: 'EASY' });
    expect(useRecommendations.getState().entries['SIMILAR:1']).toBeUndefined();
    rerender({ songId: 2, active: true, difficulty: 'NORMAL' });
    await waitFor(() => expect(fetchSimilarSongs).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchSimilarSongs).mock.calls[1].slice(0, 2)).toEqual([2, { difficulty: 'NORMAL', size: 5 }]);
    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    rerender({ songId: null, active: false, difficulty: null });
    expect(useRecommendations.getState().entries['SIMILAR:2']).toBeUndefined();
  });

  it('내장 곡 빌드·비인증이면 요청이 없다', async () => {
    useSongs.setState({ source: 'builtin' });
    setup({ songId: 1, active: true, difficulty: 'EASY' });
    cleanup();
    useSongs.setState({ source: 'api' });
    useAuth.setState({ status: 'anonymous' });
    setup({ songId: 1, active: true, difficulty: 'EASY' });
    await Promise.resolve();
    expect(fetchSimilarSongs).not.toHaveBeenCalled();
  });

  it('인증 끔 빌드에서는 로그인 상태가 남아 있어도 요청하지 않는다', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'false');
    setup({ songId: 1, active: true, difficulty: 'NORMAL' });
    await Promise.resolve();
    expect(fetchSimilarSongs).not.toHaveBeenCalled();
  });

  it('빈 결과·오류면 카드가 없다', async () => {
    vi.mocked(fetchSimilarSongs).mockRejectedValue(new Error('404'));
    const { result } = setup({ songId: 1, active: true, difficulty: 'EASY' });
    await waitFor(() => expect(useRecommendations.getState().entries['SIMILAR:1']?.status).toBe('hidden'));
    expect(result.current.cards).toEqual([]);
  });
});

describe('서버가 고른 채보', () => {
  it('선택 단계를 바꿔도 응답 난이도를 표시하고 응답 chartId로 즉시 이동한다', async () => {
    const { result, rerender } = setup({ songId: 1, active: true, difficulty: 'EASY' });
    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    expect(result.current.cards.map((c) => c.difficulty)).toEqual(['NORMAL', 'HARD']);
    rerender({ songId: 1, active: true, difficulty: 'HARD' });
    expect(result.current.cards.map((c) => c.difficulty)).toEqual(['NORMAL', 'HARD']);
    act(() => result.current.onPick(result.current.cards[0]));
    expect(postRecommendationClick).toHaveBeenCalledWith('r1', 5);
    expect(onSelect).toHaveBeenCalledWith(5, 50);
    expect(selectSong).not.toHaveBeenCalled();
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
  });
});
