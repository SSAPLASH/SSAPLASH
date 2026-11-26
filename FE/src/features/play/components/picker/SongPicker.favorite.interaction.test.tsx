// @vitest-environment happy-dom
// 곡 선택 즐겨찾기 (설계 MODE-001-MODE-003-song-favorite): 별 버튼, 즐겨찾기 칩, 0곡 안내, 브라우저 저장.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations } from '@/api/song/recommendations';
import { fetchSimilarSongs } from '@/api/song/similarSongs';
import { getSong, listSongs } from '@/api/song/songs';
import { getBestRecords } from '@/api/play/plays';
import { apiFetch } from '@/api/http';
import type { UserMe } from '@/domain/account/auth';
import type { SongLevel, SongSummary } from '@/domain/song/songCatalog';
import { queryClient } from '@/runtime/queryClient';
import { useAuth } from '@/store/authStore';
import { useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import { SongPicker } from './SongPicker';

vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));
vi.mock('@/api/song/songs', () => {
  const listSongs = vi.fn();
  return { listSongs, getSong: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await listSongs(p)).items) };
});
vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
vi.mock('@/api/play/lessons', () => ({ fetchLessons: vi.fn(() => new Promise(() => {})), postLessonCompletion: vi.fn() }));
// 서버 저장 스위치가 꺼져 있으면 즐겨찾기 때문에 BE를 부르지 않는다 — 불리면 이 mock이 잡는다
vi.mock('@/api/http', async (orig) => ({ ...(await orig<typeof import('@/api/http')>()), apiFetch: vi.fn() }));

const song = (id: number, title: string, songLevel: SongLevel = 'BEGINNER'): SongSummary => ({
  id, title, artist: `가수${id}`, source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel, difficulties: ['EASY'], createdAt: '', coverUrl: null, sheetId: null,
});
const SONGS = [song(1, '첫곡'), song(2, '둘째곡'), song(3, '셋째곡')];

function show(onStart = vi.fn()) {
  render(
    <MemoryRouter>
      <SongPicker onStart={onStart} mode="play" />
    </MemoryRouter>,
  );
  return onStart;
}

const row = (title: string) => screen.getByText(title, { selector: '.play-st-name' }).closest('tr') as HTMLElement;
const star = (title: string) => within(row(title)).getByRole('button');
const titles = () => [...document.querySelectorAll('.play-st-name')].map((el) => el.textContent);
const chip = () => screen.getByRole('button', { name: '즐겨찾기한 곡만 보기' });

beforeEach(() => {
  queryClient.clear();
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [] });
  // 난이도 칩을 누르면 서버가 그 난이도만 돌려준다
  vi.mocked(listSongs)
    .mockReset()
    .mockImplementation(async (p: { songLevel?: SongLevel }) => ({
      items: p.songLevel ? SONGS.filter((s) => s.songLevel === p.songLevel) : SONGS,
      hasNext: false,
    }));
  vi.mocked(getSong).mockReset().mockRejectedValue(new Error('no'));
  vi.mocked(fetchRecommendations).mockReset().mockResolvedValue({ requestId: 'r1', strategy: 's', items: [] });
  vi.mocked(fetchSimilarSongs).mockReset().mockResolvedValue({ requestId: 's1', strategy: 's', items: [] });
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api', scope: 'BUILTIN' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SongPicker 즐겨찾기 별', () => {
  it('행의 별을 누르면 바로 켜지고 브라우저에 저장된다. 행 선택·시작은 일어나지 않는다', async () => {
    const onStart = show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    expect(star('둘째곡').getAttribute('aria-pressed')).toBe('false');
    expect(star('둘째곡').getAttribute('aria-label')).toBe('즐겨찾기에 추가');

    fireEvent.click(star('둘째곡'));
    fireEvent.doubleClick(star('둘째곡'));

    await waitFor(() => expect(star('둘째곡').getAttribute('aria-pressed')).toBe('true'));
    expect(star('둘째곡').getAttribute('aria-label')).toBe('즐겨찾기 해제');
    expect(localStorage.getItem('ssaplash.favorites')).toBe('[2]');
    expect(row('첫곡').getAttribute('aria-selected')).toBe('true');
    expect(row('둘째곡').getAttribute('aria-selected')).toBe('false');
    expect(onStart).not.toHaveBeenCalled();
    // 서버 저장 스위치가 꺼져 있으므로 즐겨찾기 요청은 없다
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('선택한 곡 패널의 별은 선택한 곡을 바꾼다', async () => {
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    const pane = screen.getByRole('complementary', { name: '선택한 곡' });
    fireEvent.click(within(pane).getByRole('button', { name: '즐겨찾기에 추가' }));

    await waitFor(() => expect(star('첫곡').getAttribute('aria-pressed')).toBe('true'));
    expect(within(pane).getByRole('button', { name: '즐겨찾기 해제' })).toBeTruthy();
  });

  it('행에 포커스가 있을 때 F 키로 바꾸고, 선택 행의 별만 Tab 순서에 든다', async () => {
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    expect(star('첫곡').tabIndex).toBe(0);
    expect(star('둘째곡').tabIndex).toBe(-1);

    fireEvent.keyDown(row('첫곡'), { key: 'ㄹ', code: 'KeyF' });
    await waitFor(() => expect(star('첫곡').getAttribute('aria-pressed')).toBe('true'));
    // 조합 키와 함께면 바꾸지 않는다(찾기 단축키)
    fireEvent.keyDown(row('첫곡'), { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(star('첫곡').getAttribute('aria-pressed')).toBe('true');
  });

  it('저장해 둔 즐겨찾기는 다시 열어도 켜져 있다', async () => {
    localStorage.setItem('ssaplash.favorites', '[3]');
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    await waitFor(() => expect(star('셋째곡').getAttribute('aria-pressed')).toBe('true'));
    expect(star('첫곡').getAttribute('aria-pressed')).toBe('false');
  });

  it('브라우저에 저장하지 못하면 별이 되돌아가고 토스트가 뜬다', async () => {
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    // 이 테스트 환경에서는 Storage.prototype을 바꿔 끼워도 적용되지 않아 전역을 통째로 바꾼다
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    fireEvent.click(star('첫곡'));
    await screen.findByText('즐겨찾기를 저장하지 못했어요. 다시 시도해 주세요.');
    expect(star('첫곡').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('SongPicker 즐겨찾기 칩', () => {
  it('난이도 칩 뒤에 있고 처음에는 꺼져 있다', async () => {
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    expect(chip().getAttribute('aria-pressed')).toBe('false');
    const group = screen.getByRole('group', { name: '곡 난이도' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['전체', '입문', '중급', '고급']);
    expect(group.compareDocumentPosition(chip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('켜면 즐겨찾기한 곡만 남고 아래 줄이 「즐겨찾기 N곡」이 된다', async () => {
    localStorage.setItem('ssaplash.favorites', '[3,1]');
    show();
    await screen.findByText('둘째곡', { selector: '.play-st-name' });
    expect(screen.getByText('총 3곡')).toBeTruthy();

    fireEvent.click(chip());
    await waitFor(() => expect(titles()).toEqual(['첫곡', '셋째곡']));
    expect(chip().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('즐겨찾기 2곡')).toBeTruthy();

    fireEvent.click(chip());
    await waitFor(() => expect(titles()).toEqual(['첫곡', '둘째곡', '셋째곡']));
    expect(screen.getByText('총 3곡')).toBeTruthy();
  });

  it('칩을 눌러도 최고 기록을 다시 읽지 않는다', async () => {
    localStorage.setItem('ssaplash.favorites', '[1]');
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    show();
    await screen.findByText('둘째곡', { selector: '.play-st-name' });
    await waitFor(() => expect(getBestRecords).toHaveBeenCalledTimes(1));
    fireEvent.click(chip());
    await waitFor(() => expect(titles()).toEqual(['첫곡']));
    expect(getBestRecords).toHaveBeenCalledTimes(1);
  });

  it('켠 채 별을 끄면 그 행이 남고, 난이도를 바꾸면 빠진다', async () => {
    localStorage.setItem('ssaplash.favorites', '[1,2]');
    show();
    await screen.findByText('둘째곡', { selector: '.play-st-name' });
    fireEvent.click(chip());
    await waitFor(() => expect(titles()).toEqual(['첫곡', '둘째곡']));

    fireEvent.click(star('둘째곡'));
    await waitFor(() => expect(star('둘째곡').getAttribute('aria-pressed')).toBe('false'));
    expect(titles()).toEqual(['첫곡', '둘째곡']);

    fireEvent.click(screen.getByRole('button', { name: '입문' }));
    await waitFor(() => expect(titles()).toEqual(['첫곡']));
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    await waitFor(() => expect(titles()).toEqual(['첫곡']));
  });

  it('즐겨찾기가 없으면 별을 누르는 방법을 안내한다', async () => {
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    fireEvent.click(chip());
    await screen.findByText('아직 즐겨찾기한 곡이 없어요');
    expect(screen.getByText('곡 오른쪽의 ☆을 누르면 여기에 모여요.')).toBeTruthy();
    expect(screen.getByText('즐겨찾기 0곡')).toBeTruthy();
  });

  it('난이도를 고른 채 0곡이면 난이도 안내, 검색어가 있으면 검색 안내가 나온다', async () => {
    localStorage.setItem('ssaplash.favorites', '[1]');
    show();
    await screen.findByText('첫곡', { selector: '.play-st-name' });
    fireEvent.click(chip());
    fireEvent.click(screen.getByRole('button', { name: '고급' }));
    await screen.findByText('이 난이도의 즐겨찾기 곡이 없어요');

    fireEvent.change(screen.getByLabelText('곡 검색'), { target: { value: '없는곡' } });
    await screen.findByText('즐겨찾기에 맞는 곡이 없어요');
  });
});
