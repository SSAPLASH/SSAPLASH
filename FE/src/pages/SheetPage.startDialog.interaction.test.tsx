// @vitest-environment happy-dom
// 악보 연습 시작 확인 창 페이지 통합 테스트 (설계 MODE-001-MODE-003-picker-quick-start 4장).
// 실제 SheetPage·SongPicker·StartDialog를 그리고 네트워크·음향·캔버스 경계만 대체한다.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { getBestRecords } from '@/api/plays';
import { listSongs } from '@/api/songs';
import { useLive } from '@/store/liveStore';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';
import { BUILTIN_CHARTS } from '@/domain/chart';
import type { UserMe } from '@/domain/auth';
import type { SongDetail } from '@/domain/songCatalog';
import { Accompaniment } from '@/audio/Accompaniment';
import { SheetPage } from './SheetPage';

vi.mock('@/api/plays', () => ({ getBestRecords: vi.fn() }));
vi.mock('@/api/songs', async (orig) => ({ ...(await orig<typeof import('@/api/songs')>()), getSong: vi.fn(), listSongs: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await vi.mocked(listSongs)(p as never)).items) }));
vi.mock('@/api/recommendations', () => ({ fetchRecommendations: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }), postRecommendationClick: vi.fn() }));
vi.mock('@/api/similarSongs', () => ({ fetchSimilarSongs: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }) }));
vi.mock('@/api/lessons', () => ({ fetchLessons: vi.fn(() => new Promise(() => {})), postLessonCompletion: vi.fn() }));
vi.mock('@/app/playSync', () => ({ usePlaySync: create(() => ({ states: {} })), startPlaySync: vi.fn() }));
vi.mock('@/app/bootstrap', () => ({ setSoundOnHit: vi.fn(), useKeyboardDrum: vi.fn(), unlockAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/screenFit', () => ({ useScreenFits: () => true }));
vi.mock('@/components/drum/DrumKit', () => ({ DrumKit: () => null }));
vi.mock('@/components/SheetPager', () => ({ SheetPager: () => null }));
// 안내 애니메이션의 rAF 갱신이 라우터 전환 렌더를 굶기지 않게 막는다
vi.mock('@/components/guide/PickerGuide', () => ({ PickerGuide: () => null }));
vi.mock('@/store/songStore', async (original) => ({ ...(await original<typeof import('@/store/songStore')>()), loadChart: vi.fn() }));
// 반주: 불러오기 호출만 센다
vi.mock('@/audio/Accompaniment', () => {
  const load = vi.fn().mockResolvedValue(undefined);
  class Accompaniment {
    static load = load;
    state = 'idle';
    load = load;
    unload() {}
  }
  return { Accompaniment };
});

const detail: SongDetail = {
  id: 1, title: '시험곡', artist: '테스트', source: 'BUILTIN', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: true, accompanimentStatus: 'READY', songLevel: 'BEGINNER', difficulties: ['EASY', 'HARD'], createdAt: '', coverUrl: null, sheetId: null,
  license: null, updatedAt: null, charts: [
    { id: 11, difficulty: 'EASY', chartVersionId: 111, version: 1, noteCount: 4, notationStatus: 'READY' },
    { id: 12, difficulty: 'HARD', chartVersionId: 112, version: 1, noteCount: 4, notationStatus: 'READY' },
  ],
};

function Where() {
  const l = useLocation();
  return (
    <>
      <div data-testid="where">{l.pathname + l.search}</div>
      <div data-testid="state">{JSON.stringify(l.state)}</div>
    </>
  );
}
const show = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/sheet" element={<SheetPage />} />
        <Route path="/setup" element={<div>세팅 화면</div>} />
      </Routes>
    </MemoryRouter>,
  );
const where = () => screen.getByTestId('where').textContent ?? '';

beforeEach(() => {
  vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(listSongs).mockReset().mockResolvedValue({ items: [detail], hasNext: false });
  vi.mocked(loadChart).mockReset().mockImplementation(async ({ chartId }) => ({
    chart: { ...BUILTIN_CHARTS[0], title: '시험곡', chartId, songNumericId: 1, chartVersionId: chartId + 100, difficulty: chartId === 12 ? 'HARD' : 'EASY' },
    assets: { accompanimentUrl: 'https://x/acc.mp3' } as never,
  }));
  useSongs.setState({ source: 'api', selectSong: vi.fn().mockResolvedValue(detail) });
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
  useSettings.setState({ sensorKind: 'none', countInBars: 0, firstSetupDone: true, accompaniment: true });
  vi.mocked(Accompaniment as never as { load: ReturnType<typeof vi.fn> }).load?.mockClear?.();
});
afterEach(() => {
  cleanup();
  useLive.setState({ connected: [false, false] });
});

describe('SheetPage 시작 확인 창', () => {
  it('start가 없으면 곡 선택만 보이고 채보를 읽지 않는다', async () => {
    show('/sheet?song=1&chart=12');
    await screen.findByRole('complementary', { name: '선택한 곡' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loadChart).not.toHaveBeenCalled();
  });

  it('start=1이면 곡 선택 위에 플레이 창이 열리고 고른 단계로 채보를 읽는다', async () => {
    show('/sheet?song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    await waitFor(() => expect(loadChart).toHaveBeenCalledWith({ songId: 1, chartId: 12 }, expect.any(AbortSignal)));
    await within(dialog).findByRole('button', { name: '플레이' });
    expect(screen.getByRole('complementary', { name: '선택한 곡' })).toBeTruthy();
  });

  it('▶ 플레이로 연주를 시작하면 창이 닫히고 주소에서 start가 빠진다', async () => {
    show('/sheet?song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    fireEvent.click(await within(dialog).findByRole('button', { name: '플레이' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '시험곡' })).toBeNull());
    expect(where()).toBe('/sheet?song=1&chart=12');
    // 곡 선택은 사라지고 연주 화면(HUD)이 보인다
    expect(screen.queryByRole('complementary', { name: '선택한 곡' })).toBeNull();
  });

  it('닫기(취소)는 주소에서 start만 지우고 곡·단계 선택은 남긴다', async () => {
    show('/sheet?song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/sheet?song=1&chart=12');
    expect(screen.getByRole('radio', { name: 'HARD' }).getAttribute('aria-checked')).toBe('true');
  });

  it('준비가 안 되면 기기 준비 필요 창: 플레이 버튼 없이 [드럼 세팅으로]가 start=1을 returnTo에 싣는다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    show('/sheet?song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    expect(within(dialog).queryByRole('button', { name: '플레이' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '드럼 세팅으로' }));
    await screen.findByText('세팅 화면');
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').returnTo).toBe('/sheet?song=1&chart=12&start=1');
  });

  it('창이 열린 동안 기기가 준비되면 플레이 창으로 바뀐다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    show('/sheet?song=1&chart=12&start=1');
    await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    useLive.setState({ connected: [true, true] });
    await screen.findByRole('dialog', { name: '시험곡' });
  });

  it('숨긴 단계 URL은 기본 단계로 보정하면서 창은 열어 둔다', async () => {
    show('/sheet?song=1&chart=99&start=1');
    await waitFor(() => expect(loadChart).toHaveBeenCalledWith({ songId: 1, chartId: 11 }, expect.any(AbortSignal)));
    expect(where()).toContain('start=1');
    await screen.findByRole('dialog');
  });

  it('채보를 못 읽으면 오류 문구와 [다시 시도]가 창 안에 보인다', async () => {
    vi.mocked(loadChart).mockRejectedValueOnce(new Error('채보 오류'));
    show('/sheet?song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toContain('채보 오류');
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 시도' }));
    await within(dialog).findByRole('button', { name: '플레이' });
  });
});

describe('SheetPage 반주 설정', () => {
  const accLoad = () => (Accompaniment as never as { load: ReturnType<typeof vi.fn> }).load;

  it('반주가 켜져 있으면 창이 열릴 때 반주를 불러온다', async () => {
    show('/sheet?song=1&chart=12&start=1');
    await screen.findByRole('button', { name: '플레이' });
    await waitFor(() => expect(accLoad()).toHaveBeenCalled());
  });

  it('반주를 끄면 반주를 불러오지 않는다', async () => {
    useSettings.setState({ accompaniment: false });
    show('/sheet?song=1&chart=12&start=1');
    await screen.findByRole('button', { name: '플레이' });
    expect(accLoad()).not.toHaveBeenCalled();
    expect((screen.getByLabelText('반주 재생') as HTMLInputElement).checked).toBe(false);
  });
});
