// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/recommendations';
import { fetchSimilarSongs } from '@/api/similarSongs';
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
vi.mock('@/api/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));
// songStore는 전체 페이지를 읽는 listAllSongs를 쓴다. 기존 단언을 그대로 쓰려고 mock된 listSongs 한 페이지로 이어 준다
vi.mock('@/api/songs', () => {
  const listSongs = vi.fn();
  return { listSongs, getSong: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await listSongs(p)).items) };
});
vi.mock('@/api/plays', () => ({ getBestRecords: vi.fn() }));

const song = (id: number, title: string): SongSummary => ({
  id, title, artist: `가수${id}`, source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null, sheetId: null,
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
  vi.mocked(fetchSimilarSongs).mockReset().mockResolvedValue({ requestId: 's1', strategy: 's', items: [] });
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

describe('SongPicker AI 추천곡 탭·라벨 (설계 COACH-004-song-picker-ai-tab)', () => {
  const hardItem: RecommendationItem = {
    song: { ...song(78, '어려운곡'), songLevel: 'ADVANCED' }, chartId: 780, difficulty: 'HARD', reasons: [{ code: 'CHALLENGE', text: 'BE' }],
  };
  const detailOf = (s: SongSummary, charts: { id: number; difficulty: 'EASY' | 'NORMAL' | 'HARD' }[]) => ({
    ...s, license: null, updatedAt: null,
    charts: charts.map((c) => ({ ...c, chartVersionId: c.id * 10, version: 1, noteCount: 5, notationStatus: 'READY' as const })),
  });
  const row = (title: string) => screen.getByText(title, { selector: '.play-st-name' }).closest('tr') as HTMLElement;

  beforeEach(() => {
    vi.mocked(listSongs).mockResolvedValue({ items: [song(1, '목록곡'), song(77, '추천곡')], hasNext: false });
    vi.mocked(fetchRecommendations).mockResolvedValue({ requestId: 'r1', strategy: 's', items: [recoItem, hardItem] });
    // 기본 채보는 NORMAL(id = 곡 id × 10), 추천곡 77은 추천 채보 555(EASY)도 있다
    vi.mocked(getSong).mockImplementation(async (id: number) =>
      detailOf(song(id, `곡${id}`), id === 77 ? [{ id: 555, difficulty: 'EASY' }, { id: 770, difficulty: 'NORMAL' }] : [{ id: id * 10, difficulty: 'NORMAL' }]),
    );
  });

  it('탭이 [기본 곡][라이브러리][AI 추천곡]이고 추천은 진입 때 한 번(size 10), 필터 아래 카드 줄은 없다', async () => {
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '라이브러리', 'AI 추천곡']);
    await waitFor(() => expect(fetchRecommendations).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetchRecommendations).mock.calls[0][0]).toEqual({ context: 'SONG_PICKER', mode: 'RHYTHM', size: 10 });
    expect(screen.queryByRole('region', { name: '추천곡' })).toBeNull();
  });

  it('기본 곡 탭은 추천 목록에 든 곡에만 「✦ AI 추천」 라벨, AI 추천곡 탭에는 라벨이 없다', async () => {
    show();
    await waitFor(() => expect(row('추천곡').querySelector('.play-st-ai')?.textContent).toBe('✦ AI 추천'));
    expect(row('목록곡').querySelector('.play-st-ai')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    await screen.findByText('어려운곡', { selector: '.play-st-name' });
    expect(document.querySelector('.play-st-ai')).toBeNull();
  });

  it('AI 추천곡 탭은 추천 곡을 BE 순서로 보이고, 검색·칩은 곡 목록·추천을 다시 부르지 않고 거른다', async () => {
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    const listCalls = vi.mocked(listSongs).mock.calls.length;
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    await screen.findByText('어려운곡', { selector: '.play-st-name' });
    expect([...document.querySelectorAll('.play-st-name')].map((e) => e.textContent)).toEqual(['추천곡', '어려운곡']);
    expect(screen.getByText('총 2곡')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '고급' }));
    await waitFor(() => expect([...document.querySelectorAll('.play-st-name')].map((e) => e.textContent)).toEqual(['어려운곡']));
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '없는곡' } });
    await screen.findByText('검색어를 바꿔 보세요.');
    fireEvent.click(screen.getByRole('radio', { name: '기본 곡' }));
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    expect(fetchRecommendations).toHaveBeenCalledTimes(1);
    // 기본 곡 탭으로 잠깐 돌아간 것 말고는 곡 목록을 읽지 않는다
    await waitFor(() => expect(vi.mocked(listSongs).mock.calls.length).toBeLessThanOrEqual(listCalls + 1));
    expect(vi.mocked(listSongs).mock.calls.every(([p]) => p.source !== ('RECOMMEND' as never))).toBe(true);
  });

  it('추천이 비면 AI 추천곡 탭 표 틀 안에 빈 상태 문구와 「총 0곡」', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue({ requestId: 'r1', strategy: 's', items: [] });
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    await screen.findByText('아직 추천할 곡이 없어요');
    expect(screen.getByText('연주 기록을 모아서 실력에 맞는 곡을 추천해 드릴게요.')).toBeTruthy();
    expect(screen.getByText('총 0곡')).toBeTruthy();
    expect(screen.getByText('목록에서 곡을 고르면 여기에 보여요.')).toBeTruthy();
  });

  it('AI 추천곡 탭에서 고른 곡의 [준비]는 추천 채보로 가고 클릭을 기록한다', async () => {
    const onSelect = show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    await screen.findByText('어려운곡', { selector: '.play-st-name' });
    fireEvent.click(row('추천곡'));
    await waitFor(() => expect((screen.getByRole('button', { name: '준비' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '준비' }));
    expect(onSelect).toHaveBeenCalledWith(77, 555);
    expect(postRecommendationClick).toHaveBeenCalledWith('r1', 77);
  });

  it('추천 채보가 곡 상세에 없으면 기본 채보로 간다', async () => {
    const onSelect = show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    fireEvent.click(await screen.findByText('어려운곡', { selector: '.play-st-name' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '준비' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '준비' }));
    expect(onSelect).toHaveBeenCalledWith(78, 780);
  });

  it('기본 곡 탭의 라벨 곡 [준비]는 기본 채보이고 클릭 기록이 없다', async () => {
    const onSelect = show();
    await waitFor(() => expect(row('추천곡').querySelector('.play-st-ai')).toBeTruthy());
    fireEvent.click(row('추천곡'));
    await waitFor(() => expect((screen.getByRole('button', { name: '준비' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '준비' }));
    expect(onSelect).toHaveBeenCalledWith(77, 770);
    expect(postRecommendationClick).not.toHaveBeenCalled();
  });

  it('내장 곡 소스면 탭·요청·라벨이 없다', async () => {
    useSongs.setState({ source: 'builtin' });
    show();
    await screen.findByText('리듬에 맞춰 도전해요');
    expect(screen.queryByRole('radio', { name: 'AI 추천곡' })).toBeNull();
    expect(fetchRecommendations).not.toHaveBeenCalled();
  });

  it('로그인하지 않았으면 탭은 2개이고 추천·비슷한 곡 요청이 없다', async () => {
    useAuth.setState({ status: 'unknown' });
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '라이브러리']);
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchRecommendations).not.toHaveBeenCalled();
    expect(fetchSimilarSongs).not.toHaveBeenCalled();
    expect(document.querySelector('.play-st-ai')).toBeNull();
  });
});

describe('SongPicker 선택한 곡 패널 비슷한 곡', () => {
  const similarSong = { ...song(9, '비슷한곡'), songLevel: 'ADVANCED' as const };

  beforeEach(() => {
    vi.mocked(listSongs).mockResolvedValue({ items: [song(1, '첫곡'), song(2, '둘째곡')], hasNext: false });
    vi.mocked(getSong).mockImplementation(async (id: number) => ({
      ...song(id, `곡${id}`), license: null, updatedAt: null,
      charts: [{ id: id * 10, difficulty: 'NORMAL' as const, chartVersionId: id * 100, version: 1, noteCount: 5, notationStatus: 'READY' as const }],
    }));
    vi.mocked(fetchSimilarSongs).mockImplementation(async (songId: number) => ({
      requestId: `s${songId}`, strategy: 's',
      items: [
        { song: song(songId, '자기자신'), chartId: 1, difficulty: 'NORMAL', similarity: 1, matchedOn: [] },
        { song: similarSong, chartId: 90, difficulty: 'NORMAL', similarity: 0.8, matchedOn: ['RHYTHM'] },
      ],
    }));
  });

  it('선택이 300ms 그대로인 곡만 요청하고, 선택한 곡이 아닌 첫 항목을 보인다', async () => {
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    // 자동 선택된 첫곡에서 바로 둘째곡으로 넘기면 첫곡은 요청하지 않는다
    fireEvent.click(screen.getByText('둘째곡', { selector: '.play-st-name' }));
    await screen.findByText('✦ 이 곡과 비슷한 곡');
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchSimilarSongs).mock.calls[0][0]).toBe(2);
    expect(vi.mocked(fetchSimilarSongs).mock.calls[0][1]).toMatchObject({ size: 3 });
    const pane = screen.getByRole('complementary', { name: '선택한 곡' });
    expect(pane.querySelector('.play-sd-similar-title')?.textContent).toBe('비슷한곡');
    expect(pane.querySelector('.play-sd-similar-meta')?.textContent).toBe('가수9 · 고급');
    expect(pane.querySelector('.play-sd-similar-reason')?.textContent).toBe('리듬이 비슷해요');
  });

  it('[이 곡 보기]는 클릭을 기록하고 탭·칩은 그대로 패널만 그 곡으로 바꾸며, [준비]는 기본 채보다', async () => {
    const onSelect = show();
    await screen.findByText('✦ 이 곡과 비슷한 곡');
    fireEvent.click(screen.getByRole('button', { name: '이 곡 보기' }));
    expect(postRecommendationClick).toHaveBeenCalledWith('s1', 9);
    const pane = screen.getByRole('complementary', { name: '선택한 곡' });
    await waitFor(() => expect(pane.querySelector('.play-sd-title')?.textContent).toBe('비슷한곡'));
    expect((screen.getByRole('radio', { name: '기본 곡' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.play-st-row.selected')).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: '준비' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '준비' }));
    expect(onSelect).toHaveBeenCalledWith(9, 90);
  });

  it('비슷한 곡이 없으면 구분선까지 없다', async () => {
    vi.mocked(fetchSimilarSongs).mockResolvedValue({ requestId: 's', strategy: 's', items: [] });
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    await waitFor(() => expect(fetchSimilarSongs).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('.play-sd-divider')).toBeNull();
  });
});

describe('SongPicker 빈 목록·선택 유지 (설계 CHART-001 곡 난이도 4-2)', () => {
  const detailOf = (s: SongSummary, chartId: number) => ({
    ...s, license: null, updatedAt: null,
    charts: [{ id: chartId, difficulty: 'NORMAL' as const, chartVersionId: chartId * 10, version: 1, noteCount: 5, notationStatus: 'READY' as const }],
  });

  beforeEach(() => {
    useAuth.setState({ status: 'unknown' });
    vi.mocked(getSong).mockImplementation(async (id: number) => detailOf(song(id, `곡${id}`), id * 10));
  });

  it('난이도 결과가 0곡이면 표 머리글과 「총 0곡」을 두고 본문에 안내한다', async () => {
    vi.mocked(listSongs).mockImplementation(async (p) => ({ items: p.songLevel === 'ADVANCED' ? [] : [song(1, '목록곡')], hasNext: false }));
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    fireEvent.click(screen.getByRole('button', { name: '고급' }));
    await screen.findByText('이 난이도의 곡이 없어요');
    expect(screen.getByText('다른 난이도를 골라 보세요.')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '곡 난이도' })).toBeTruthy();
    expect(screen.getByText('총 0곡')).toBeTruthy();
  });

  it('라이브러리 탭 0곡이면 본문에 라이브러리 안내, 곡이 있으면 안내가 없다', async () => {
    vi.mocked(listSongs).mockImplementation(async (p) => ({ items: p.source === 'MINE' ? [] : [song(1, '목록곡')], hasNext: false }));
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    expect(screen.queryByText(/처리 중·실패한 곡은/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '라이브러리' }));
    await screen.findByText('아직 고를 수 있는 곡이 없어요');
    expect(screen.getByText(/처리 중·실패한 곡은/).querySelector('a')?.getAttribute('href')).toBe('/studio');
  });

  it('고른 곡이 필터로 목록에서 빠져도 패널에 남고 [준비]가 그 곡으로 간다', async () => {
    vi.mocked(listSongs).mockImplementation(async (p) => ({
      items: p.songLevel === 'ADVANCED' ? [song(3, '고급곡')] : [song(1, '첫곡'), song(2, '둘째곡')],
      hasNext: false,
    }));
    const onSelect = show();
    fireEvent.click(await screen.findByText('둘째곡', { selector: '.play-st-name' }));
    fireEvent.click(screen.getByRole('button', { name: '고급' }));
    await screen.findByText('고급곡', { selector: '.play-st-name' });
    const pane = screen.getByRole('complementary', { name: '선택한 곡' });
    expect(pane.querySelector('.play-sd-title')?.textContent).toBe('둘째곡');
    expect(document.querySelector('.play-st-row.selected')).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: '준비' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '준비' }));
    expect(onSelect).toHaveBeenCalledWith(2, 20);
  });

  it('한 번도 고르지 않았고 0곡이면 패널은 안내 문구다', async () => {
    vi.mocked(listSongs).mockResolvedValue({ items: [], hasNext: false });
    show();
    await screen.findByText('곡이 없어요');
    expect(screen.getByText('목록에서 곡을 고르면 여기에 보여요.')).toBeTruthy();
  });
});
