// @vitest-environment happy-dom
// 리듬 게임 시작·재개·다시 시작 전 오디오 시계 대기 (설계 MODE-001 오디오 시계 시작 대기 A6·A7·A8).
// 대기 훅만 대체해 대기를 테스트가 끝내게 하고, 시계(PlayClock)가 대기가 끝난 뒤에만 움직이는지 본다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { getBestRecords } from '@/api/play/plays';
import { listSongs } from '@/api/song/songs';
import { useLive } from '@/store/liveStore';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';
import { BUILTIN_CHARTS } from '@/domain/song/chart';
import type { UserMe } from '@/domain/account/auth';
import type { SongDetail } from '@/domain/song/songCatalog';
import { PlayClock } from './sessionClock';
import { PlayPage } from './PlayPage';

// 오디오 시계 대기: 테스트가 끝낼 때까지 걸어 두거나(manual) 바로 통과시킨다
const gate = vi.hoisted(() => ({
  manual: false,
  notice: false,
  calls: [] as { phase: string; resolve: (ok: boolean) => void }[],
}));
vi.mock('@/features/play/components/stage/useAudioClockGate', () => ({
  useAudioClockGate: () => ({
    notice: gate.notice,
    wait: (phase: string) =>
      gate.manual ? new Promise<boolean>((resolve) => gate.calls.push({ phase, resolve })) : Promise.resolve(true),
  }),
}));
vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), getSong: vi.fn(), listSongs: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await vi.mocked((await import('@/api/song/songs')).listSongs)(p as never)).items) }));
vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }) }));
vi.mock('@/runtime/playSync', () => ({ usePlaySync: create(() => ({ states: {} })), startPlaySync: vi.fn() }));
vi.mock('@/runtime/hitSound', async (orig) => ({ ...(await orig<typeof import('@/runtime/hitSound')>()), setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ setKeyboardDrum: vi.fn(), useKeyboardDrum: vi.fn() }));
vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/play/components/stage/screenFit', () => ({ useScreenFits: () => true }));
vi.mock('@/components/drum/DrumKit', () => ({ DrumKit: () => null }));
vi.mock('@/features/play/components/picker/guide/PickerGuide', () => ({ PickerGuide: () => null }));
vi.mock('@/features/play/components/stage/highway/NoteHighway', () => ({ NoteHighway: () => null }));
vi.mock('@/store/songStore', async (original) => ({ ...(await original<typeof import('@/store/songStore')>()), loadChart: vi.fn() }));
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

const show = () =>
  render(
    <MemoryRouter initialEntries={['/play']}>
      <Routes>
        <Route path="/play" element={<PlayPage />} />
        <Route path="/result/:id" element={<div>결과 화면</div>} />
      </Routes>
    </MemoryRouter>,
  );
/** 연주 단계(곡 선택 카드가 사라짐) */
const playing = () => screen.queryByRole('complementary', { name: '선택한 곡' }) === null;
/** 카드의 ▶ 플레이를 누른다 */
const startPlaying = async () => {
  const play = await screen.findByRole('button', { name: '플레이' });
  await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(play);
};

let begin: ReturnType<typeof vi.spyOn>;
let resume: ReturnType<typeof vi.spyOn>;
let restart: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  gate.manual = false;
  gate.notice = false;
  gate.calls.length = 0;
  begin = vi.spyOn(PlayClock.prototype, 'begin');
  resume = vi.spyOn(PlayClock.prototype, 'resume');
  restart = vi.spyOn(PlayClock.prototype, 'restart');
  localStorage.clear();
  vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(listSongs).mockReset().mockResolvedValue({ items: [detail], hasNext: false });
  vi.mocked(loadChart).mockReset().mockImplementation(async ({ chartId }) => ({
    chart: { ...BUILTIN_CHARTS[0], title: '시험곡', chartId, songNumericId: 1, chartVersionId: chartId + 100, difficulty: chartId === 12 ? 'HARD' : 'EASY' },
    assets: { accompanimentUrl: 'https://x/acc.mp3' } as never,
  }));
  useSongs.setState({ source: 'api', selectSong: vi.fn().mockResolvedValue(detail) });
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
  useSettings.setState({ sensorKind: 'none', countInBars: 0, firstSetupDone: true, accompaniment: false, metronome: false });
});
afterEach(() => {
  cleanup();
  // vi.restoreAllMocks()는 vi.mock 안의 vi.fn 구현(unlockAudio 등)까지 지우므로, 이 파일이 만든 스파이만 되돌린다
  begin.mockRestore();
  resume.mockRestore();
  restart.mockRestore();
  useLive.setState({ connected: [false, false] });
});

/** 마지막으로 걸린 대기를 끝낸다 */
const release = async (ok = true) => {
  await waitFor(() => expect(gate.calls.length).toBeGreaterThan(0));
  const call = gate.calls[gate.calls.length - 1];
  await act(async () => call.resolve(ok));
  return call.phase;
};
/** 연주 중 Esc로 일시정지 창을 연다 */
const pauseByEscape = async () => {
  fireEvent.keyDown(window, { code: 'Escape' });
  return screen.findByRole('dialog', { name: '일시정지' });
};

describe('PlayPage 오디오 시계 대기', () => {
  it('시작은 오디오 시계 대기가 끝난 뒤에야 시계를 움직인다(begin)', async () => {
    gate.manual = true;
    show();
    await startPlaying();
    await waitFor(() => expect(gate.calls.map((c) => c.phase)).toEqual(['begin']));
    expect(begin).not.toHaveBeenCalled();
    expect(playing()).toBe(false);
    expect(await release()).toBe('begin');
    await waitFor(() => expect(playing()).toBe(true));
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('대기가 거짓으로 끝나면(기다리는 사이 화면을 떠남·중복) 시작하지 않는다', async () => {
    gate.manual = true;
    show();
    await startPlaying();
    await release(false);
    await act(async () => {});
    expect(begin).not.toHaveBeenCalled();
    expect(playing()).toBe(false);
  });

  it('[계속]은 대기가 끝난 뒤에 재개하고, 그동안 일시정지 창은 그대로다(resume)', async () => {
    show();
    await startPlaying();
    await waitFor(() => expect(playing()).toBe(true));
    const dialog = await pauseByEscape();
    gate.manual = true;
    fireEvent.click(within(dialog).getByRole('button', { name: '계속' }));
    expect(resume).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '일시정지' })).toBeTruthy();
    expect(await release()).toBe('resume');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '일시정지' })).toBeNull());
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('[계속]을 누른 뒤 대기 중에 [다시 시작]을 누르면, 늦게 끝난 재개 대기는 아무것도 하지 않는다', async () => {
    show();
    await startPlaying();
    await waitFor(() => expect(playing()).toBe(true));
    const dialog = await pauseByEscape();
    gate.manual = true;
    fireEvent.click(within(dialog).getByRole('button', { name: '계속' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 시작' }));
    expect(gate.calls.map((c) => c.phase)).toEqual(['resume', 'restart']);
    // 다시 시작이 먼저 끝나 시계가 카운트인부터 돈다
    await act(async () => gate.calls[1].resolve(true));
    expect(restart).toHaveBeenCalledTimes(1);
    // 그 뒤에 끝난 재개 대기: 시계가 이미 돌고 있어(일시정지가 아님) 재개하지 않는다
    await act(async () => gate.calls[0].resolve(true));
    expect(resume).not.toHaveBeenCalled();
  });

  it('[다시 시작]은 대기가 끝난 뒤에 카운트인부터 다시 한다(restart)', async () => {
    show();
    await startPlaying();
    await waitFor(() => expect(playing()).toBe(true));
    const dialog = await pauseByEscape();
    gate.manual = true;
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 시작' }));
    expect(restart).not.toHaveBeenCalled();
    expect(await release()).toBe('restart');
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('[다시 시작] 대기 중에 나가면 다시 시작하지 않는다', async () => {
    show();
    await startPlaying();
    await waitFor(() => expect(playing()).toBe(true));
    const dialog = await pauseByEscape();
    gate.manual = true;
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 시작' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '나가기' }));
    await release();
    expect(restart).not.toHaveBeenCalled();
  });

  it('대기가 길어지면 「오디오 준비 중…」을 보인다', async () => {
    gate.notice = true;
    show();
    expect((await screen.findByRole('status', { name: '' }).catch(() => screen.getByText('오디오 준비 중…'))).textContent).toContain('오디오 준비 중…');
  });

  it('PlayClock에 오디오 시계 읽기를 넘긴다(곡 도중 멈춤 진단)', async () => {
    const audioClock = vi.fn(() => null);
    const spy = vi.spyOn(await import('@/audio/AudioEngine').then((m) => m.audioEngine), 'clockReading').mockImplementation(audioClock);
    show();
    await startPlaying();
    await waitFor(() => expect(playing()).toBe(true));
    const deps = (begin.mock.contexts[0] as unknown as { deps: { audioClock?: () => unknown } }).deps;
    expect(deps.audioClock?.()).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
