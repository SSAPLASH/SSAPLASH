// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/song/recommendations';
import { fetchSimilarSongs } from '@/api/song/similarSongs';
import { getSong, listSongs } from '@/api/song/songs';
import type { RecommendationItem } from '@/domain/song/recommendation';
import type { SongSummary } from '@/domain/song/songCatalog';
import { useAuth } from '@/store/authStore';
import { useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import { SongPicker } from './SongPicker';
import { getBestRecords } from '@/api/play/plays';
import { queryClient } from '@/runtime/queryClient';
import type { UserMe } from '@/domain/account/auth';

vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));
// songStore는 전체 페이지를 읽는 listAllSongs를 쓴다. 기존 단언을 그대로 쓰려고 mock된 listSongs 한 페이지로 이어 준다
vi.mock('@/api/song/songs', () => {
  const listSongs = vi.fn();
  return { listSongs, getSong: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await listSongs(p)).items) };
});
vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
// 학습 코스 탭 본문은 이 파일의 관심사가 아니다 — 응답하지 않는 요청으로 둔다
vi.mock('@/api/play/lessons', () => ({ fetchLessons: vi.fn(() => new Promise(() => {})), postLessonCompletion: vi.fn() }));

const song = (id: number, title: string): SongSummary => ({
  id, title, artist: `가수${id}`, source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null, sheetId: null,
});
const recoItem: RecommendationItem = {
  song: song(77, '추천곡'), chartId: 555, difficulty: 'EASY', reasons: [{ code: 'STARTER', text: 'BE 문구' }],
};

function show(onStart = vi.fn()) {
  render(
    <MemoryRouter>
      <SongPicker onStart={onStart} mode="play" />
    </MemoryRouter>,
  );
  return onStart;
}

beforeEach(() => {
  // 곡 목록 캐시는 앱 전역 인스턴스다. 테스트마다 비운다
  queryClient.clear();
  vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(listSongs).mockReset().mockResolvedValue({ items: [song(1, '목록곡')], hasNext: false });
  vi.mocked(getSong).mockReset().mockRejectedValue(new Error('no'));
  vi.mocked(fetchRecommendations).mockReset().mockResolvedValue({ requestId: 'r1', strategy: 's', items: [recoItem] });
  vi.mocked(postRecommendationClick).mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchSimilarSongs).mockReset().mockResolvedValue({ requestId: 's1', strategy: 's', items: [] });
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api', scope: 'BUILTIN' });
});

describe('SongPicker starting', () => {
  it('starting을 넘기면 카드의 ▶ 플레이가 스피너이고, 넘기지 않으면 평소대로다', async () => {
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    vi.mocked(getSong).mockResolvedValue({ ...song(1, '목록곡'), license: null, updatedAt: null, charts: [{ id: 11, difficulty: 'EASY', chartVersionId: 111, version: 1, noteCount: 5, notationStatus: 'READY' }] });
    const view = render(<MemoryRouter><SongPicker mode="play" onStart={vi.fn()} starting /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector('.play-sd-play .spinner')).not.toBeNull());
    expect((document.querySelector('.play-sd-play') as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    render(<MemoryRouter><SongPicker mode="sheet" onStart={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector('.play-sd-play .spinner')).toBeNull();
  });
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
    render(<MemoryRouter><SongPicker mode={mode} onStart={vi.fn()} /></MemoryRouter>);
    // play: 표는 곡 전체 최고(654), 카드는 고른 단계(11)의 최고(321). sheet: 표·카드 모두 76.5%
    await waitFor(() => expect(screen.getAllByText(mode === 'play' ? '654' : '76.5%').length).toBe(mode === 'play' ? 1 : 2));
    if (mode === 'play') expect(screen.getByText('321')).toBeTruthy();
    expect(getBestRecords).toHaveBeenCalledWith([1], expect.any(AbortSignal));
  });
  it('실패 중에도 시작이 가능하고 재시도 뒤 0점이 표시된다', async () => {
    vi.mocked(getBestRecords).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: 'RHYTHM', bestScore: 0, bestAccuracy: 0 },
    ] });
    const onStart = show();
    await screen.findByText('최고 기록을 불러오지 못했어요.');
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(1, 11);
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

  it('탭이 [기본 곡][내 곡][AI 추천곡]이고 추천은 진입 때 한 번(size 10), 필터 아래 카드 줄은 없다', async () => {
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    expect(within(screen.getByRole('radiogroup', { name: '곡 범위' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '내 곡', 'AI 추천곡']);
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

  it('AI 추천곡 탭에서 고른 곡의 [플레이]는 추천 채보로 가고 클릭을 기록한다', async () => {
    const onStart = show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    await screen.findByText('어려운곡', { selector: '.play-st-name' });
    fireEvent.click(row('추천곡'));
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(77, 555);
    expect(postRecommendationClick).toHaveBeenCalledWith('r1', 77);
  });

  it('추천 채보가 곡 상세에 없으면 기본 채보로 간다', async () => {
    const onStart = show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    fireEvent.click(await screen.findByText('어려운곡', { selector: '.play-st-name' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(78, 780);
  });

  it('기본 곡 탭의 라벨 곡 [플레이]는 기본 채보이고 클릭 기록이 없다', async () => {
    const onStart = show();
    await waitFor(() => expect(row('추천곡').querySelector('.play-st-ai')).toBeTruthy());
    fireEvent.click(row('추천곡'));
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(77, 770);
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
    expect(within(screen.getByRole('radiogroup', { name: '곡 범위' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '내 곡']);
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

  it('[이 곡 보기]는 클릭을 기록하고 탭·칩은 그대로 패널만 그 곡으로 바꾸며, [플레이]는 기본 채보다', async () => {
    const onStart = show();
    await screen.findByText('✦ 이 곡과 비슷한 곡');
    fireEvent.click(screen.getByRole('button', { name: '이 곡 보기' }));
    expect(postRecommendationClick).toHaveBeenCalledWith('s1', 9);
    const pane = screen.getByRole('complementary', { name: '선택한 곡' });
    await waitFor(() => expect(pane.querySelector('.play-sd-title')?.textContent).toBe('비슷한곡'));
    expect((screen.getByRole('radio', { name: '기본 곡' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.play-st-row.selected')).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(9, 90);
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

  it('내 곡 범위 0곡이면 본문에 라이브러리 안내, 곡이 있으면 안내가 없다', async () => {
    vi.mocked(listSongs).mockImplementation(async (p) => ({ items: p.source === 'MINE' ? [] : [song(1, '목록곡')], hasNext: false }));
    show();
    await screen.findByText('목록곡', { selector: '.play-st-name' });
    expect(screen.queryByText(/처리 중·실패한 곡은/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '내 곡' }));
    await screen.findByText('아직 고를 수 있는 곡이 없어요');
    expect(screen.getByText(/처리 중·실패한 곡은/).querySelector('a')?.getAttribute('href')).toBe('/studio');
  });

  it('고른 곡이 필터로 목록에서 빠져도 패널에 남고 [플레이]가 그 곡으로 간다', async () => {
    vi.mocked(listSongs).mockImplementation(async (p) => ({
      items: p.songLevel === 'ADVANCED' ? [song(3, '고급곡')] : [song(1, '첫곡'), song(2, '둘째곡')],
      hasNext: false,
    }));
    const onStart = show();
    fireEvent.click(await screen.findByText('둘째곡', { selector: '.play-st-name' }));
    fireEvent.click(screen.getByRole('button', { name: '고급' }));
    await screen.findByText('고급곡', { selector: '.play-st-name' });
    const pane = screen.getByRole('complementary', { name: '선택한 곡' });
    expect(pane.querySelector('.play-sd-title')?.textContent).toBe('둘째곡');
    expect(document.querySelector('.play-st-row.selected')).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(2, 20);
  });

  it('한 번도 고르지 않았고 0곡이면 패널은 안내 문구다', async () => {
    vi.mocked(listSongs).mockResolvedValue({ items: [], hasNext: false });
    show();
    await screen.findByText('곡이 없어요');
    expect(screen.getByText('목록에서 곡을 고르면 여기에 보여요.')).toBeTruthy();
  });
});

describe('SongPicker 곡 목록 캐시 (설계 TECH-350)', () => {
  it('탭을 바꿨다 돌아오면 곡 목록을 다시 요청하지 않고 바로 보인다', async () => {
    show();
    await screen.findAllByText('목록곡');
    expect(listSongs).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: '내 곡' }));
    await waitFor(() => expect(listSongs).toHaveBeenCalledTimes(2));
    expect(vi.mocked(listSongs).mock.calls[1][0]).toMatchObject({ source: 'MINE' });
    fireEvent.click(screen.getByRole('radio', { name: '기본 곡' }));
    expect(screen.getAllByText('목록곡').length).toBeGreaterThan(0);
    expect(listSongs).toHaveBeenCalledTimes(2);
  });
  it('다시 마운트해도 30초 안이면 요청하지 않는다', async () => {
    show();
    await screen.findAllByText('목록곡');
    cleanup();
    show();
    expect(screen.getAllByText('목록곡').length).toBeGreaterThan(0);
    expect(listSongs).toHaveBeenCalledTimes(1);
  });
  it('마지막으로 연 목록 탭을 songStore.scope에 남긴다', async () => {
    show();
    await screen.findAllByText('목록곡');
    fireEvent.click(screen.getByRole('radio', { name: '내 곡' }));
    await waitFor(() => expect(useSongs.getState().scope).toBe('MINE'));
  });
});

describe('SongPicker 안내 줄·배치 (설계 MODE-003 곡 선택 안내 영역)', () => {
  const showMode = (mode: 'play' | 'sheet') =>
    render(
      <MemoryRouter>
        <SongPicker onStart={vi.fn()} mode={mode} />
      </MemoryRouter>,
    );
  const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  // 접힘 상태가 테스트 사이에 새지 않게 비운다
  beforeEach(() => {
    localStorage.removeItem('airdrum.picker.guideFold.sheet');
    localStorage.removeItem('airdrum.picker.guideFold.play');
  });

  it.each([
    ['sheet', '악보로 차근차근 연습해요', '악보 연습 안내'],
    ['play', '리듬에 맞춰 도전해요', '리듬 게임 안내'],
  ] as const)('%s: 안내 접이 바가 제목과 안내 줄 사이에 있고 접으면 안쪽이 inert가 된다', async (mode, title, label) => {
    showMode(mode);
    await screen.findAllByText('목록곡');
    const bar = document.querySelector('.guide-fold-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(follows(screen.getByRole('heading', { name: title }), bar)).toBe(true);
    expect(follows(bar, screen.getByRole('region', { name: label }))).toBe(true);
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(bar);
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.guide-fold-inner')?.hasAttribute('inert')).toBe(true);
  });

  it('/sheet: 학습 코스 탭에는 안내 접이 바가 없다', async () => {
    showMode('sheet');
    await screen.findAllByText('목록곡');
    expect(document.querySelector('.guide-fold-bar')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '학습 코스' }));
    expect(document.querySelector('.guide-fold-bar')).toBeNull();
  });

  it('/sheet: 제목 → 안내 줄 → 구분선 → 목록 영역 순서', async () => {
    showMode('sheet');
    await screen.findAllByText('목록곡');
    const title = screen.getByRole('heading', { name: '악보로 차근차근 연습해요' });
    const guide = screen.getByRole('region', { name: '악보 연습 안내' });
    const sep = screen.getByRole('separator');
    const grid = document.querySelector('.play-sp-grid') as HTMLElement;
    expect(follows(title, guide)).toBe(true);
    expect(follows(guide, sep)).toBe(true);
    expect(follows(sep, grid)).toBe(true);
    // 안내 줄 오른쪽 칸은 악보 읽는 법 카드
    expect(guide.contains(screen.getByRole('region', { name: '악보 읽는 법' }))).toBe(true);
  });

  it('/play: 제목 → 레인 안내 줄 → 구분선 → 목록 영역 순서, 악보 안내는 없다', async () => {
    showMode('play');
    await screen.findAllByText('목록곡');
    const title = screen.getByRole('heading', { name: '리듬에 맞춰 도전해요' });
    const guide = screen.getByRole('region', { name: '리듬 게임 안내' });
    const sep = screen.getByRole('separator');
    const grid = document.querySelector('.play-sp-grid') as HTMLElement;
    expect(follows(title, guide)).toBe(true);
    expect(follows(guide, sep)).toBe(true);
    expect(follows(sep, grid)).toBe(true);
    // 안내 줄 오른쪽 칸은 레인 읽는 법 카드
    expect(guide.contains(screen.getByRole('region', { name: '레인 읽는 법' }))).toBe(true);
    expect(screen.queryByRole('region', { name: '악보 연습 안내' })).toBeNull();
    expect(screen.queryByRole('region', { name: '악보 읽는 법' })).toBeNull();
  });

  it('/sheet: 학습 코스 탭에서는 안내 줄·구분선이 숨고 기본 곡 탭으로 돌아오면 다시 보인다', async () => {
    showMode('sheet');
    await screen.findAllByText('목록곡');
    fireEvent.click(screen.getByRole('radio', { name: '학습 코스' }));
    expect(screen.queryByRole('region', { name: '악보 연습 안내' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '기본 곡' }));
    await screen.findAllByText('목록곡');
    expect(screen.getByRole('region', { name: '악보 연습 안내' })).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it.each(['play', 'sheet'] as const)('%s: 탭과 표는 왼쪽 열, 선택 곡 카드는 목록 영역 오른쪽 열이다', async (mode) => {
    showMode(mode);
    await screen.findAllByText('목록곡');
    const grid = document.querySelector('.play-sp-grid') as HTMLElement;
    const list = grid.querySelector('.play-sp-list') as HTMLElement;
    const card = screen.getByRole('complementary', { name: '선택한 곡' });
    expect(card.parentElement).toBe(grid);
    expect(list.parentElement).toBe(grid);
    expect(follows(list, card)).toBe(true);
    // 탭은 왼쪽 열의 첫 요소 — 카드 윗선과 같은 줄에서 시작한다. 두 모드 모두 범위 줄은 범위 버튼뿐이다(미니게임 링크는 제목 줄에 있다)
    const tabs = screen.getByRole('radiogroup', { name: '곡 범위' });
    expect(list.firstElementChild).toBe(tabs);
    expect(list.querySelector('a[href="/play/mini"]')).toBeNull();
    expect(list.querySelector('table')).not.toBeNull();
    expect(list.contains(card)).toBe(false);
  });
});

describe('SongPicker 바로 플레이 (설계 MODE-001-MODE-003-picker-quick-start, MODE-001-play-quick-start)', () => {
  const detail = (id: number) => ({
    ...song(id, `곡${id}`), license: null, updatedAt: null,
    charts: [
      { id: id * 10 + 1, difficulty: 'EASY' as const },
      { id: id * 10 + 2, difficulty: 'NORMAL' as const },
    ].map((c) => ({ ...c, chartVersionId: c.id, version: 1, noteCount: 5, notationStatus: 'READY' as const })),
  });
  const showMode = (mode: 'play' | 'sheet', url = `/${mode}`) => {
    const onStart = vi.fn();
    render(
      <MemoryRouter initialEntries={[url]}>
        <SongPicker mode={mode} onStart={onStart} />
      </MemoryRouter>,
    );
    return { onStart };
  };
  const showSheet = (url = '/sheet') => showMode('sheet', url);

  beforeEach(() => {
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    vi.mocked(listSongs).mockResolvedValue({ items: [song(1, '목록곡'), song(2, '둘째곡')], hasNext: false });
    vi.mocked(getSong).mockImplementation(async (id: number) => detail(id));
  });

  it('[플레이]는 기본 단계(NORMAL)로 onStart를 부른다([준비]는 없다)', async () => {
    const { onStart } = showSheet();
    const play = await screen.findByRole('button', { name: '플레이' });
    await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: '준비' })).toBeNull();
    fireEvent.click(play);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(1, 12);
  });

  it('단계를 바꾸면 그 단계로 시작하고, 다른 곡을 고르면 그 곡의 기본 단계로 돌아간다', async () => {
    const { onStart } = showSheet();
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('radio', { name: 'EASY' }));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenLastCalledWith(1, 11);
    fireEvent.click(screen.getByText('둘째곡', { selector: '.play-st-name' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'NORM' }).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenLastCalledWith(2, 22);
  });

  it('주소의 song·chart로 그 곡·단계를 처음부터 골라 둔다', async () => {
    const { onStart } = showSheet('/sheet?song=2&chart=21');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'EASY' }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByRole('complementary', { name: '선택한 곡' }).textContent).toContain('둘째곡');
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(2, 21);
  });

  it('더블클릭도 고른 단계로 onStart', async () => {
    const { onStart } = showSheet();
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('radio', { name: 'EASY' }));
    fireEvent.doubleClick(screen.getByText('목록곡', { selector: '.play-st-name' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(1, 11));
  });

  it('고른 단계의 최고 정확도를 카드에 보인다', async () => {
    vi.mocked(getBestRecords).mockResolvedValue({ items: [
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: 'SHEET', bestScore: null, bestAccuracy: 55 },
      { songId: 1, chartId: 12, difficulty: 'NORMAL', mode: 'SHEET', bestScore: null, bestAccuracy: 91 },
    ] });
    showSheet();
    const card = await screen.findByRole('complementary', { name: '선택한 곡' });
    await waitFor(() => expect(card.textContent).toContain('91.0%'));
    fireEvent.click(screen.getByRole('radio', { name: 'EASY' }));
    await waitFor(() => expect(card.textContent).toContain('55.0%'));
  });

  it('/play도 같은 카드다: 단계 세그먼트·[플레이]가 있고 [준비]는 없다', async () => {
    const { onStart } = showMode('play');
    const play = await screen.findByRole('button', { name: '플레이' });
    await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: '준비' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'NORM' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'EASY' }));
    fireEvent.click(play);
    expect(onStart).toHaveBeenCalledWith(1, 11);
  });

  it('/play: 주소의 song·chart로 그 곡·단계를 골라 두고, 더블클릭도 고른 단계로 onStart', async () => {
    const { onStart } = showMode('play', '/play?song=2&chart=21');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'EASY' }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByRole('complementary', { name: '선택한 곡' }).textContent).toContain('둘째곡');
    fireEvent.doubleClick(screen.getByText('둘째곡', { selector: '.play-st-name' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(2, 21));
  });

  it('/play: 주소로 골라 둔 곡이면 ▶ 플레이에 포커스를 준다(다시 하기 복귀). /sheet와 주소 없는 진입은 주지 않는다', async () => {
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    showMode('play', '/play?song=2&chart=21');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '플레이' })));
    cleanup();
    showMode('sheet', '/sheet?song=2&chart=21');
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    await nextFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '플레이' }));
    cleanup();
    showMode('play');
    await waitFor(() => expect((screen.getByRole('button', { name: '플레이' }) as HTMLButtonElement).disabled).toBe(false));
    await nextFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '플레이' }));
  });

  it('/play: 내장 곡(음수 id)도 주소의 song·chart로 골라 둔다', async () => {
    vi.mocked(listSongs).mockResolvedValue({ items: [song(-1, '내장 첫째'), song(-2, '내장 둘째')], hasNext: false });
    const { onStart } = showMode('play', '/play?song=-2&chart=-19');
    await waitFor(() => expect(screen.getByRole('complementary', { name: '선택한 곡' }).textContent).toContain('내장 둘째'));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'EASY' }).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: '플레이' }));
    expect(onStart).toHaveBeenCalledWith(-2, -19);
  });

  it('/play: 카드는 고른 단계의 최고 점수를 보이고, 표는 곡 전체 최고 점수다. 기록이 없으면 —', async () => {
    vi.mocked(getBestRecords).mockResolvedValue({ items: [
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: 'RHYTHM', bestScore: 1500, bestAccuracy: 55 },
      { songId: 1, chartId: 12, difficulty: 'NORMAL', mode: 'RHYTHM', bestScore: 98765, bestAccuracy: 91 },
    ] });
    showMode('play');
    const card = await screen.findByRole('complementary', { name: '선택한 곡' });
    await waitFor(() => expect(card.textContent).toContain('98,765'));
    expect(card.textContent).toContain('최고 점수');
    fireEvent.click(screen.getByRole('radio', { name: 'EASY' }));
    await waitFor(() => expect(card.textContent).toContain('1,500'));
    expect(card.textContent).not.toContain('98,765');
    // 표의 최고 점수 열은 곡 전체 최고
    expect(screen.getByText('98,765', { selector: '.play-st-row td, .play-st-row td *' })).toBeTruthy();
  });
});

describe('SongPicker 악보 연습 범위와 주소 (설계 MODE-003-악보-연습-하위-메뉴)', () => {
  /** 지금 주소를 읽는 표시와, 사이드바 하위 메뉴 클릭을 흉내 내는 링크들 */
  function Shell() {
    const loc = useLocation();
    return (
      <>
        <output data-testid="loc">{loc.pathname + loc.search}</output>
        <Link to="/sheet">go-builtin</Link>
        <Link to="/sheet?scope=MINE">go-mine</Link>
        <Link to="/sheet?tab=recommend">go-ai</Link>
        <Link to="/sheet?tab=lessons">go-lessons</Link>
        <Link to="/play">go-play-builtin</Link>
        <Link to="/play?scope=MINE">go-play-mine</Link>
        <Link to="/play?tab=recommend">go-play-ai</Link>
      </>
    );
  }
  const open = (url: string, props: { mode?: 'play' | 'sheet' } = {}) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <Shell />
        <SongPicker mode={props.mode ?? 'sheet'} onStart={vi.fn()} />
      </MemoryRouter>,
    );
  const loc = () => screen.getByTestId('loc').textContent;
  const checked = () => screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')?.textContent;
  const lastScope = () => (vi.mocked(listSongs).mock.calls.at(-1)?.[0] as { source?: string } | undefined)?.source;

  beforeEach(() => {
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    vi.mocked(listSongs).mockResolvedValue({ items: [song(1, '목록곡')], hasNext: false });
  });

  it('주소 값이 없으면 기본 곡이다 — 마지막에 본 범위(내 곡)를 기억하지 않는다', async () => {
    useSongs.setState({ scope: 'MINE' });
    open('/sheet');
    await screen.findAllByText('목록곡');
    expect(checked()).toBe('기본 곡');
    expect(lastScope()).toBe('BUILTIN');
  });

  it('리듬 게임도 주소가 범위를 정한다 — 값이 없으면 마지막에 본 범위가 아니라 기본 곡, scope=MINE은 내 곡', async () => {
    useSongs.setState({ scope: 'MINE' });
    open('/play', { mode: 'play' });
    await screen.findAllByText('목록곡');
    expect(checked()).toBe('기본 곡');
    expect(lastScope()).toBe('BUILTIN');
    cleanup();
    open('/play?scope=MINE', { mode: 'play' });
    await screen.findAllByText('목록곡');
    expect(checked()).toBe('내 곡');
    expect(lastScope()).toBe('MINE');
  });

  it('?scope=MINE은 내 곡, ?tab=recommend는 AI 추천곡, ?tab=lessons는 학습 코스로 연다', async () => {
    open('/sheet?scope=MINE');
    await screen.findAllByText('목록곡');
    expect(checked()).toBe('내 곡');
    expect(lastScope()).toBe('MINE');
    cleanup();

    open('/sheet?tab=recommend');
    await screen.findByText('추천곡', { selector: '.play-st-name' });
    expect(checked()).toBe('AI 추천곡');
    cleanup();

    open('/sheet?tab=lessons');
    await waitFor(() => expect(checked()).toBe('학습 코스'));
    expect(document.querySelector('.play-sp-grid')).toBeNull();
  });

  it('탭을 누르면 주소가 그 범위 값으로 바뀌고 곡·단계 값은 남는다', async () => {
    open('/sheet?song=1&chart=11');
    await screen.findAllByText('목록곡');
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    expect(loc()).toBe('/sheet?song=1&chart=11&tab=recommend');
    fireEvent.click(screen.getByRole('radio', { name: '내 곡' }));
    expect(loc()).toBe('/sheet?song=1&chart=11&scope=MINE');
    fireEvent.click(screen.getByRole('radio', { name: '학습 코스' }));
    expect(loc()).toBe('/sheet?song=1&chart=11&tab=lessons');
    fireEvent.click(screen.getByRole('radio', { name: '기본 곡' }));
    expect(loc()).toBe('/sheet?song=1&chart=11');
  });

  it('주소만 바뀌어도(사이드바 하위 메뉴) 범위가 따라 바뀐다', async () => {
    open('/sheet');
    await screen.findAllByText('목록곡');
    fireEvent.click(screen.getByText('go-ai'));
    await waitFor(() => expect(checked()).toBe('AI 추천곡'));
    await screen.findByText('추천곡', { selector: '.play-st-name' });
    fireEvent.click(screen.getByText('go-mine'));
    await waitFor(() => expect(checked()).toBe('내 곡'));
    fireEvent.click(screen.getByText('go-lessons'));
    await waitFor(() => expect(checked()).toBe('학습 코스'));
    fireEvent.click(screen.getByText('go-builtin'));
    await waitFor(() => expect(checked()).toBe('기본 곡'));
  });

  it('로그인하지 않았으면 ?tab=recommend·?tab=lessons도 기본 곡이다', async () => {
    useAuth.setState({ status: 'anonymous', user: null });
    open('/sheet?tab=recommend');
    await screen.findAllByText('목록곡');
    expect(checked()).toBe('기본 곡');
    cleanup();
    open('/sheet?tab=lessons');
    await screen.findAllByText('목록곡');
    expect(checked()).toBe('기본 곡');
  });

  it('리듬 게임에서 범위를 누르면 주소가 바뀌고 곡·단계 값은 남는다(학습 코스 버튼은 없다)', async () => {
    open('/play?song=1&chart=11', { mode: 'play' });
    await screen.findAllByText('목록곡');
    expect(within(screen.getByRole('radiogroup', { name: '곡 범위' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '내 곡', 'AI 추천곡']);
    fireEvent.click(screen.getByRole('radio', { name: 'AI 추천곡' }));
    expect(loc()).toBe('/play?song=1&chart=11&tab=recommend');
    expect(checked()).toBe('AI 추천곡');
    fireEvent.click(screen.getByRole('radio', { name: '내 곡' }));
    expect(loc()).toBe('/play?song=1&chart=11&scope=MINE');
    fireEvent.click(screen.getByRole('radio', { name: '기본 곡' }));
    expect(loc()).toBe('/play?song=1&chart=11');
  });

  it('리듬 게임도 주소만 바뀌면(사이드바 하위 메뉴) 범위가 따라 바뀐다', async () => {
    open('/play', { mode: 'play' });
    await screen.findAllByText('목록곡');
    fireEvent.click(screen.getByText('go-play-ai'));
    await waitFor(() => expect(checked()).toBe('AI 추천곡'));
    fireEvent.click(screen.getByText('go-play-mine'));
    await waitFor(() => expect(checked()).toBe('내 곡'));
    fireEvent.click(screen.getByText('go-play-builtin'));
    await waitFor(() => expect(checked()).toBe('기본 곡'));
  });

  it('리듬 게임은 ?tab=recommend를 AI 추천곡으로, ?tab=lessons는 기본 곡으로 읽는다', async () => {
    open('/play?tab=recommend', { mode: 'play' });
    await screen.findByText('추천곡', { selector: '.play-st-name' });
    expect(checked()).toBe('AI 추천곡');
    cleanup();
    open('/play?tab=lessons', { mode: 'play' });
    await screen.findAllByText('목록곡');
    expect(checked()).toBe('기본 곡');
  });

  it('리듬 게임에는 제목 줄 오른쪽에 「미니게임」 링크(/play/mini)가 있고 악보 연습에는 없다', async () => {
    open('/play', { mode: 'play' });
    await screen.findAllByText('목록곡');
    const link = screen.getByRole('link', { name: '미니게임' });
    expect(link.getAttribute('href')).toBe('/play/mini');
    // 제목과 같은 머리(header) 안, 동작 자리에 있다. 범위 줄·목록 영역 안이 아니다
    const head = screen.getByRole('heading', { name: '리듬에 맞춰 도전해요' }).closest('header') as HTMLElement;
    expect(head.contains(link)).toBe(true);
    expect(link.closest('.ui-page-actions')).not.toBeNull();
    expect(document.querySelector('.play-sp-grid')?.contains(link)).toBe(false);
    cleanup();
    open('/sheet');
    await screen.findAllByText('목록곡');
    expect(screen.queryByRole('link', { name: '미니게임' })).toBeNull();
  });

  it('내장 곡 출처(범위 줄 없음)에서도 리듬 게임에는 「미니게임」 링크가 보인다', async () => {
    useSongs.setState({ source: 'builtin' });
    open('/play', { mode: 'play' });
    expect(screen.queryByRole('radiogroup', { name: '곡 범위' })).toBeNull();
    const link = screen.getByRole('link', { name: '미니게임' });
    expect(link.getAttribute('href')).toBe('/play/mini');
    expect(link.closest('.ui-page-actions')).not.toBeNull();
  });

  // 학습 코스 설계 4-4절: 사이드바 하위 메뉴가 펼쳐져 있어도 화면 위 버튼을 다시 둔다
  it('화면 위 범위 버튼은 네 범위 모두에서 보이고 주소의 범위가 켜져 있다', async () => {
    const cases: [string, string][] = [
      ['/sheet', '기본 곡'],
      ['/sheet?scope=MINE', '내 곡'],
      ['/sheet?tab=recommend', 'AI 추천곡'],
      ['/sheet?tab=lessons', '학습 코스'],
    ];
    for (const [url, label] of cases) {
      open(url);
      const group = await screen.findByRole('radiogroup', { name: '곡 범위' });
      expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '내 곡', 'AI 추천곡', '학습 코스']);
      await waitFor(() => expect(checked()).toBe(label));
      cleanup();
    }
  });
});
