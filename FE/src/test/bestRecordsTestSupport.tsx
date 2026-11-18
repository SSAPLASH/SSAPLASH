// 리듬 게임 곡 카드·시작(자동 시작)의 최고 기록 회귀 시나리오. 네트워크·음향·캔버스 경계만 대체한다.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { create } from 'zustand';
import { getBestRecords } from '@/api/play/plays';
import { listSongs } from '@/api/song/songs';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';
import { BUILTIN_CHARTS } from '@/domain/song/chart';
import type { UserMe } from '@/domain/account/auth';
import type { SongDetail } from '@/domain/song/songCatalog';
import * as playLogs from '@/engine/playLog';
import type { PlayLog } from '@/domain/play/playLog';

vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), getSong: vi.fn(), listSongs: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await vi.mocked(listSongs)(p as never)).items) }));
// 곡 선택의 비슷한 곡·추천이 실제 네트워크로 나가지 않게 막는다(이 시나리오는 추천을 검증하지 않는다)
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }) }));
vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }), postRecommendationClick: vi.fn() }));
vi.mock('@/runtime/playSync', () => ({ usePlaySync: create(() => ({ states: {} })), startPlaySync: vi.fn() }));
vi.mock('@/runtime/hitSound', async (orig) => ({ ...(await orig<typeof import('@/runtime/hitSound')>()), setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ setKeyboardDrum: vi.fn(), useKeyboardDrum: vi.fn() }));
vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/play/components/stage/screenFit', () => ({ useScreenFits: () => true }));
vi.mock('@/components/drum/DrumKit', () => ({ DrumKit: () => null }));
// 하이웨이는 그리지 않고 프레임 콜백만 잡아 둔다 — 테스트가 곡 끝을 흉내 낸다
const frame: { current: ((now: number) => void) | null } = { current: null };
vi.mock('@/features/play/components/stage/highway/NoteHighway', () => ({
  NoteHighway: ({ onFrame }: { onFrame?: (now: number) => void }) => {
    frame.current = onFrame ?? null;
    return null;
  },
}));
vi.mock('@/features/play/components/stage/sheet/SheetPager', () => ({ SheetPager: () => null }));
vi.mock('@/store/songStore', async (original) => ({ ...await original<typeof import('@/store/songStore')>(), loadChart: vi.fn() }));

const detail: SongDetail = {
  id: 1, title: '시험곡', artist: '테스트', source: 'BUILTIN', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY', 'HARD'], createdAt: '', coverUrl: null, sheetId: null,
  license: null, updatedAt: null, charts: [
    { id: 11, difficulty: 'EASY', chartVersionId: 111, version: 1, noteCount: 4, notationStatus: 'READY' },
    { id: 12, difficulty: 'HARD', chartVersionId: 112, version: 1, noteCount: 4, notationStatus: 'READY' },
  ],
};

const mode = 'RHYTHM';

export function testReadyBestRecords(Page: ComponentType) {
  // 이동한 주소와 state를 보여 주는 탐침
  function Where() {
    const l = useLocation();
    return (
      <>
        <div data-testid="where">{l.pathname + l.search}</div>
        <div data-testid="state">{JSON.stringify(l.state)}</div>
      </>
    );
  }
  beforeEach(() => {
    frame.current = null;
    // 앞 시나리오가 끝까지 쳐서 남긴 로컬 로그가 이전 최고 기록으로 잡히지 않게 비운다
    localStorage.clear();
    vi.mocked(listSongs).mockReset().mockResolvedValue({ items: [detail], hasNext: false });
    vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [
      { songId: 1, chartId: 11, difficulty: 'EASY', mode, bestScore: 100, bestAccuracy: 98.76 },
      { songId: 1, chartId: 12, difficulty: 'HARD', mode, bestScore: 500, bestAccuracy: 0 },
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: 'SHEET', bestScore: 999, bestAccuracy: 50 },
    ] });
    vi.mocked(loadChart).mockImplementation(async ({ chartId }) => ({ chart: { ...BUILTIN_CHARTS[0], title: '시험곡', chartId, songNumericId: 1, chartVersionId: chartId + 100, difficulty: chartId === 12 ? 'HARD' : 'EASY' }, assets: null }));
    useSongs.setState({ source: 'api', selectSong: vi.fn().mockResolvedValue(detail) });
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    useSettings.setState({ sensorKind: 'none', countInBars: 0, firstSetupDone: true });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const show = (query = 'song=1&chart=11') => render(
    <MemoryRouter initialEntries={[`/play?${query}`]}>
      <Where />
      <Routes>
        <Route path="/play" element={<Page />} />
        <Route path="/result/:id" element={<div>결과 화면</div>} />
      </Routes>
    </MemoryRouter>,
  );
  // 선택 곡 카드(곡 선택 화면). 팝업이 열려 있어도 DOM에는 있다
  const card = () => document.querySelector('.play-sd') as HTMLElement | null;
  const cardText = () => card()?.textContent ?? '';

  describe(`${mode} 곡 카드 최고 점수`, () => {
    it('기록 없음은 —이며 내장 개발 소스는 기존 로컬 기록을 유지한다', async () => {
      vi.mocked(getBestRecords).mockResolvedValue({ items: [] });
      const view = show();
      await waitFor(() => expect(cardText()).toContain('최고 점수'));
      await waitFor(() => expect(screen.queryByText('최고 기록을 불러오는 중…')).toBeNull());
      expect(cardText()).toContain('—');
      view.unmount();
      vi.mocked(getBestRecords).mockClear();
      useSongs.setState({ source: 'builtin' });
      vi.spyOn(playLogs, 'loadPlayLogs').mockReturnValue([{ mode, chartId: 11, songNumericId: 1, summary: { score: 4200, accuracy: 0.42 } } as PlayLog]);
      show();
      await waitFor(() => expect(cardText()).toContain('4,200'));
      expect(getBestRecords).not.toHaveBeenCalled();
    });
    it('직접 진입 후 선택 단계의 점수를 표시하고 단계 변경은 다시 조회하지 않는다', async () => {
      show();
      await waitFor(() => expect(cardText()).toContain('100'));
      expect(cardText()).not.toContain('500');
      const calls = vi.mocked(getBestRecords).mock.calls.length;
      fireEvent.click(screen.getByRole('radio', { name: 'HARD' }));
      await waitFor(() => expect(cardText()).toContain('500'));
      expect(vi.mocked(getBestRecords).mock.calls.length).toBe(calls);
      await waitFor(() => expect(screen.getByRole('button', { name: '플레이' }).hasAttribute('disabled')).toBe(false));
    });
    it('오류는 시작을 막지 않고 재시도하면 서버값을 표시한다', async () => {
      vi.mocked(getBestRecords).mockRejectedValueOnce(new Error('offline'));
      show();
      await screen.findByText('최고 기록을 불러오지 못했어요.');
      await waitFor(() => expect(screen.getByRole('button', { name: '플레이' }).hasAttribute('disabled')).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
      await waitFor(() => expect(cardText()).toContain('100'));
    });
    it('숨긴 단계 URL은 카드가 기본 단계로 고르고 그 기록을 표시하며, 플레이는 그 단계로 읽는다', async () => {
      show('song=1&chart=99');
      await waitFor(() => expect(cardText()).toContain('100'));
      // 주소만으로는 채보를 읽지 않는다
      expect(loadChart).not.toHaveBeenCalled();
      const play = screen.getByRole('button', { name: '플레이' });
      await waitFor(() => expect(play.hasAttribute('disabled')).toBe(false));
      fireEvent.click(play);
      await waitFor(() => expect(loadChart).toHaveBeenCalledWith({ songId: 1, chartId: 11 }, expect.any(AbortSignal)));
    });
    it('느린 요청 중 이탈하면 신호를 취소한다', async () => {
      let resolve!: (value: { items: [] }) => void;
      vi.mocked(getBestRecords).mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
      const view = show();
      await screen.findByText('최고 기록을 불러오는 중…');
      // 로딩 문구는 렌더에서, 요청은 그 뒤 패시브 effect에서 나간다. 느린 환경에서는 문구가 먼저 보일 수 있어 호출을 기다린다
      await waitFor(() => expect(getBestRecords).toHaveBeenCalledTimes(1));
      const signal = vi.mocked(getBestRecords).mock.calls[0][1];
      view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => resolve({ items: [] }));
    });
  });

  describe(`${mode} 시작 시점의 이전 최고 기록 고정`, () => {
    // 곡 끝까지 간 것처럼 프레임을 크게 넘겨 결과 화면으로 보낸다
    const finishRun = async () => {
      await waitFor(() => expect(frame.current).not.toBeNull());
      await act(async () => frame.current?.(performance.now() + 3_600_000));
      await screen.findByText('결과 화면');
      return JSON.parse(screen.getByTestId('state').textContent ?? 'null') as { prevBest: { score: number | null; accuracy: number | null } };
    };
    // 카드의 ▶ 플레이를 눌러 자동 시작한다(팝업 없음). 자동 시작은 서버 최고 기록 조회가 끝난 뒤에 일어나야 한다
    const clickPlay = async () => {
      const play = await screen.findByRole('button', { name: '플레이' });
      await waitFor(() => expect(play.hasAttribute('disabled')).toBe(false));
      fireEvent.click(play);
    };
    it('시작 대기 중 읽은 서버 최고 점수가 시작 때 고정되어 결과 화면으로 넘어간다', async () => {
      // 응답을 늦춰도 자동 시작이 응답보다 먼저 일어나지 않아야 한다(곡 전체 최고 점수 500)
      const real = vi.mocked(getBestRecords).getMockImplementation();
      vi.mocked(getBestRecords).mockImplementation(async (...args) => {
        await new Promise((r) => setTimeout(r, 30));
        return real!(...args);
      });
      // 기본 판정 폭(HARD 채보)이라 서버 값을 합친다
      show('song=1&chart=12');
      await clickPlay();
      const state = await finishRun();
      expect(state.prevBest.score).toBe(500);
    });
    it('넓힌 판정 폭(EASY 채보)으로 시작한 판은 서버 최고값을 치기 전 최고값에 넣지 않는다', async () => {
      // 서버 응답에는 판정 폭이 없어 ±60ms 기록과 섞을 수 없다. 같은 폭의 로컬 로그가 없으니 null
      show('song=1&chart=11');
      await clickPlay();
      const state = await finishRun();
      expect(state.prevBest.score).toBeNull();
    });
    it('서버 기록이 없으면 이전 최고 점수 없음(null)으로 넘어간다', async () => {
      vi.mocked(getBestRecords).mockResolvedValue({ items: [] });
      show();
      await clickPlay();
      const state = await finishRun();
      expect(state.prevBest.score).toBeNull();
    });
  });
}
