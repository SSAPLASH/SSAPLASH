// @vitest-environment happy-dom
// 키보드 드럼은 연주 중에만 받는다: 리듬 게임의 곡 선택·기기 준비 팝업(시작 대기)에서는 키를 치지도 막지도 않는다
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSong, listAllSongs } from '@/api/song/songs';
import { keyboardSource } from '@/runtime/sources';
import type { Chart, Difficulty } from '@/domain/song/chart';
import type { SongDetail } from '@/domain/song/songCatalog';
import { PlayPage } from './PlayPage';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';

vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), getSong: vi.fn(), listSongs: vi.fn().mockResolvedValue({ items: [], hasNext: false }), listAllSongs: vi.fn() }));
vi.mock('@/store/songStore', async (orig) => ({ ...(await orig<typeof import('@/store/songStore')>()), loadChart: vi.fn() }));
// 카드 클릭 안에서 부르는 오디오 잠금 해제는 AudioContext가 없는 테스트 환경에서 막아 둔다
vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn().mockResolvedValue({ items: [] }) }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn().mockResolvedValue({ requestId: 's', strategy: 'x', items: [] }) }));
vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn().mockResolvedValue({ requestId: 'r', strategy: 's', items: [] }), postRecommendationClick: vi.fn() }));

const detail: SongDetail = {
  id: 1, title: '곡1', artist: 'a', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 10000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: null, difficulties: ['NORMAL' as Difficulty], createdAt: '', coverUrl: null, sheetId: null,
  license: null, updatedAt: null, charts: [{ id: 11, difficulty: 'NORMAL', chartVersionId: 1, version: 1, noteCount: 4 } as never],
};
const chart: Chart = {
  songId: '1', title: '곡1', difficulty: 'NORMAL', bpm: 120, offsetMs: 0, beatsPerBar: 4,
  notes: [{ timeMs: 1000, pad: 'SNARE' as never }], source: 'MIDI', durationMs: 10000, chartId: 11, songNumericId: 1, chartVersionId: 1,
};

function pressPrevented(): boolean {
  const ev = new KeyboardEvent('keydown', { code: 'KeyJ', cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

beforeEach(async () => {
  vi.mocked(loadChart).mockReset().mockResolvedValue({ chart, assets: null });
  vi.mocked(getSong).mockReset().mockResolvedValue(detail);
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api' });
  keyboardSource.setKeys(['KeyJ']);
  await keyboardSource.connect();
});
afterEach(async () => {
  cleanup();
  await keyboardSource.disconnect();
});

describe('PlayPage 키보드 드럼 범위', () => {
  it('곡 선택 단계에서는 키를 막지 않는다', () => {
    render(<MemoryRouter initialEntries={['/play']}><Routes><Route path="/play" element={<PlayPage />} /></Routes></MemoryRouter>);
    expect(pressPrevented()).toBe(false);
  });

  it('기기 준비 팝업(시작 대기)에서도 키를 막지 않고, 떠난 뒤에도 꺼져 있다', async () => {
    // 기기가 준비되지 않으면 ▶ 플레이 뒤 팝업이 뜬 채 연주 전에 머문다
    useSettings.setState({ sensorKind: 'pointer', firstSetupDone: true });
    vi.mocked(listAllSongs).mockResolvedValue([detail]);
    const { unmount } = render(<MemoryRouter initialEntries={['/play']}><Routes><Route path="/play" element={<PlayPage />} /></Routes></MemoryRouter>);
    const play = await screen.findByRole('button', { name: '플레이' });
    await waitFor(() => expect(play.hasAttribute('disabled')).toBe(false));
    fireEvent.click(play);
    await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    await waitFor(() => expect(loadChart).toHaveBeenCalled());
    expect(pressPrevented()).toBe(false);
    unmount();
    expect(pressPrevented()).toBe(false);
  });
});
