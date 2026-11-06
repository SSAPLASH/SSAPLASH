// 양 모드 준비 화면의 공통 회귀 시나리오. 네트워크·음향·캔버스 경계만 대체한다.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { create } from 'zustand';
import { getBestRecords } from '@/api/plays';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';
import { BUILTIN_CHARTS } from '@/domain/chart';
import type { UserMe } from '@/domain/auth';
import type { SongDetail } from '@/domain/songCatalog';
import * as playLogs from '@/engine/playLog';

vi.mock('@/api/plays', () => ({ getBestRecords: vi.fn() }));
// 준비 단계의 비슷한 곡 줄이 실제 네트워크로 나가지 않게 막는다(이 시나리오는 비슷한 곡을 검증하지 않는다)
vi.mock('@/api/similarSongs', () => ({ fetchSimilarSongs: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }) }));
vi.mock('@/app/playSync', () => ({ usePlaySync: create(() => ({ states: {} })), startPlaySync: vi.fn() }));
vi.mock('@/app/bootstrap', () => ({ setSoundOnHit: vi.fn(), unlockAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/screenFit', () => ({ useScreenFits: () => true }));
vi.mock('@/components/drum/DrumKit', () => ({ DrumKit: () => null }));
vi.mock('@/components/NoteHighway', () => ({ NoteHighway: () => null }));
vi.mock('@/components/SheetPager', () => ({ SheetPager: () => null }));
vi.mock('@/store/songStore', async (original) => ({ ...await original<typeof import('@/store/songStore')>(), loadChart: vi.fn() }));

const detail: SongDetail = {
  id: 1, title: '시험곡', artist: '테스트', source: 'BUILTIN', status: 'READY', bpm: 120, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY', 'HARD'], createdAt: '', coverUrl: null, sheetId: null,
  license: null, updatedAt: null, charts: [
    { id: 11, difficulty: 'EASY', chartVersionId: 111, version: 1, noteCount: 4, notationStatus: 'READY' },
    { id: 12, difficulty: 'HARD', chartVersionId: 112, version: 1, noteCount: 4, notationStatus: 'READY' },
  ],
};

export function testReadyBestRecords(Page: ComponentType, mode: 'RHYTHM' | 'SHEET') {
  beforeEach(() => {
    vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [
      { songId: 1, chartId: 11, difficulty: 'EASY', mode, bestScore: 100, bestAccuracy: 98.76 },
      { songId: 1, chartId: 12, difficulty: 'HARD', mode, bestScore: 500, bestAccuracy: 0 },
      { songId: 1, chartId: 11, difficulty: 'EASY', mode: mode === 'RHYTHM' ? 'SHEET' : 'RHYTHM', bestScore: 999, bestAccuracy: 50 },
    ] });
    vi.mocked(loadChart).mockImplementation(async ({ chartId }) => ({ chart: { ...BUILTIN_CHARTS[0], title: '시험곡', chartId, songNumericId: 1, chartVersionId: chartId + 100, difficulty: chartId === 12 ? 'HARD' : 'EASY' }, assets: null }));
    useSongs.setState({ source: 'api', selectSong: vi.fn().mockResolvedValue(detail) });
    useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
    useSettings.setState({ sensorKind: 'none', countInBars: 0 });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const show = (chartId = 11) => render(<MemoryRouter initialEntries={[`/${mode === 'RHYTHM' ? 'play' : 'sheet'}?song=1&chart=${chartId}`]}><Page /></MemoryRouter>);

  describe(`${mode} 준비 최고 기록`, () => {
    it('기록 없음은 —이며 내장 개발 소스는 기존 로컬 기록을 유지한다', async () => {
      vi.mocked(getBestRecords).mockResolvedValue({ items: [] });
      const view = show();
      await screen.findByText(/최고 정확도 —/);
      await waitFor(() => expect(screen.queryByText('최고 기록을 불러오는 중…')).toBeNull());
      view.unmount();
      vi.mocked(getBestRecords).mockClear();
      useSongs.setState({ source: 'builtin' });
      vi.spyOn(playLogs, 'loadPlayLogs').mockReturnValue([{ mode, chartId: 11, songNumericId: 1, summary: { accuracy: 0.42 } } as playLogs.PlayLog]);
      show();
      await screen.findByText(/최고 정확도 42.0%/);
      expect(getBestRecords).not.toHaveBeenCalled();
    });
    it('직접 진입 후 선택 단계의 정확도를 표시하고 단계 변경은 조회하지 않는다', async () => {
      show();
      await screen.findByText(/최고 정확도 98.8%/);
      fireEvent.click(screen.getByRole('button', { name: 'HARD' }));
      await screen.findByText(/최고 정확도 0.0%/);
      expect(getBestRecords).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /^시작/ }).hasAttribute('disabled')).toBe(false);
    });
    it('오류는 시작을 막지 않고 재시도하면 서버값을 표시한다', async () => {
      vi.mocked(getBestRecords).mockRejectedValueOnce(new Error('offline'));
      show();
      await screen.findByText('최고 기록을 불러오지 못했어요.');
      expect(screen.getByRole('button', { name: /^시작/ }).hasAttribute('disabled')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
      await screen.findByText(/최고 정확도 98.8%/);
    });
    it('숨긴 단계 URL을 기본 단계로 보정하고 그 기록을 표시한다', async () => {
      show(99);
      await screen.findByText(/최고 정확도 98.8%/);
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
}
