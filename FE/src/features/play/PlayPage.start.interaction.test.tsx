// @vitest-environment happy-dom
// 리듬 게임 시작 흐름 페이지 통합 테스트 (설계 MODE-001-play-quick-start v0.2 E1~E9).
// 실제 PlayPage·SongPicker·StartDialog를 그리고 네트워크·음향·캔버스 경계만 대체한다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { getBestRecords } from '@/api/play/plays';
import { listSongs } from '@/api/song/songs';
import { resetRecordingForTest, toggleArm, useRecordingStore } from '@/runtime/recordingStore';
import { useLive } from '@/store/liveStore';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';
import { loadPlayLogs } from '@/engine/playLog';
import { BUILTIN_CHARTS } from '@/domain/song/chart';
import type { UserMe } from '@/domain/account/auth';
import type { SongDetail } from '@/domain/song/songCatalog';
import { Accompaniment } from '@/audio/Accompaniment';
import { PlayPage } from './PlayPage';

// PlayClock 생성 인자를 잡는다(clickOn 확인용)
const clock = vi.hoisted(() => ({ deps: null as { clickOn(): boolean } | null, session: null as { windows: { perfectMs: number; goodMs: number } } | null }));
vi.mock('./sessionClock', async (orig) => {
  const m = await orig<typeof import('./sessionClock')>();
  class PlayClock extends m.PlayClock {
    constructor(session: ConstructorParameters<typeof m.PlayClock>[0], deps: ConstructorParameters<typeof m.PlayClock>[1]) {
      super(session, deps);
      clock.deps = deps;
      clock.session = session;
    }
  }
  return { ...m, PlayClock };
});
vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), getSong: vi.fn(), listSongs: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await vi.mocked(listSongs)(p as never)).items) }));
vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }) }));
vi.mock('@/runtime/playSync', () => ({ usePlaySync: create(() => ({ states: {} })), startPlaySync: vi.fn() }));
vi.mock('@/runtime/hitSound', async (orig) => ({ ...(await orig<typeof import('@/runtime/hitSound')>()), setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ setKeyboardDrum: vi.fn(), useKeyboardDrum: vi.fn() }));
vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/play/components/stage/screenFit', () => ({ useScreenFits: () => true }));
vi.mock('@/components/drum/DrumKit', () => ({ DrumKit: () => null }));
// 안내 애니메이션의 rAF 갱신이 라우터 전환 렌더를 굶기지 않게 막는다
vi.mock('@/features/play/components/picker/guide/PickerGuide', () => ({ PickerGuide: () => null }));
// 하이웨이는 그리지 않고 프레임 콜백만 잡아 둔다 — 테스트가 곡 끝을 흉내 낸다
const frame: { current: ((now: number) => void) | null } = { current: null };
vi.mock('@/features/play/components/stage/highway/NoteHighway', () => ({
  NoteHighway: ({ onFrame }: { onFrame?: (now: number) => void }) => {
    frame.current = onFrame ?? null;
    return null;
  },
}));
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
const show = (url = '/play', state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[state === undefined ? url : { pathname: url.split('?')[0], search: url.includes('?') ? `?${url.split('?')[1]}` : '', state }]}>
      <Where />
      <Routes>
        <Route path="/play" element={<PlayPage />} />
        <Route path="/setup" element={<div>세팅 화면</div>} />
        <Route path="/result/:id" element={<div>결과 화면</div>} />
      </Routes>
    </MemoryRouter>,
  );
const where = () => screen.getByTestId('where').textContent ?? '';
const accLoad = () => (Accompaniment as never as { load: ReturnType<typeof vi.fn> }).load;
/** 카드의 ▶ 플레이를 누른다(채보 정보를 읽어 활성이 된 뒤) */
const clickCardPlay = async () => {
  const play = await screen.findByRole('button', { name: '플레이' });
  await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(play);
};
/** 연주 단계(곡 선택 카드가 사라짐) */
const playing = () => screen.queryByRole('complementary', { name: '선택한 곡' }) === null;

beforeEach(() => {
  frame.current = null;
  clock.deps = null;
  clock.session = null;
  localStorage.clear();
  resetRecordingForTest();
  vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(listSongs).mockReset().mockResolvedValue({ items: [detail], hasNext: false });
  vi.mocked(loadChart).mockReset().mockImplementation(async ({ chartId }) => ({
    chart: { ...BUILTIN_CHARTS[0], title: '시험곡', chartId, songNumericId: 1, chartVersionId: chartId + 100, difficulty: chartId === 12 ? 'HARD' : 'EASY' },
    assets: { accompanimentUrl: 'https://x/acc.mp3' } as never,
  }));
  useSongs.setState({ source: 'api', selectSong: vi.fn().mockResolvedValue(detail) });
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
  // 반주 설정은 악보 연습 설정이다. 꺼 둬도 게임은 반주를 불러온다
  useSettings.setState({ sensorKind: 'none', countInBars: 0, firstSetupDone: true, accompaniment: false, metronome: false, timingCal: null, timingCalPrompt: 'done' });
  accLoad().mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  useLive.setState({ connected: [false, false], clockSkew: null });
  resetRecordingForTest();
});

describe('PlayPage 시작 흐름', () => {
  it('?song=&chart=만으로는 시작하지 않고 채보도 읽지 않는다(곡·단계는 골라 둔다)', async () => {
    show('/play?song=1&chart=12');
    await screen.findByRole('complementary', { name: '선택한 곡' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loadChart).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'HARD' }).getAttribute('aria-checked')).toBe('true'));
  });

  it('기기가 준비되면 팝업 없이 바로 시작하고 주소에 start가 생기지 않는다', async () => {
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'EASY' }));
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/play?song=1&chart=11');
    expect(loadChart).toHaveBeenCalledWith({ songId: 1, chartId: 11 }, expect.any(AbortSignal));
    // 반주는 반주 설정과 상관없이 불러온다
    expect(accLoad()).toHaveBeenCalledWith('https://x/acc.mp3', expect.any(AbortSignal));
    // 연주 중 Esc는 일시정지
    fireEvent.keyDown(window, { code: 'Escape' });
    await screen.findByRole('dialog', { name: '일시정지' });
  });

  it('주소에 다른 단계가 남아 있어도 카드에서 고른 단계만 읽고 그 단계로 시작한다', async () => {
    show('/play?song=1&chart=12');
    fireEvent.click(await screen.findByRole('radio', { name: 'EASY' }));
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(where()).toBe('/play?song=1&chart=11');
    // 주소가 바뀌기 전의 단계(12)는 읽지 않는다
    expect(vi.mocked(loadChart).mock.calls.map(([q]) => q.chartId)).toEqual([11]);
  });

  it('[다시 하기]로 들어오면(state.autoStart) 곡 선택을 거치지 않고 바로 시작하고, 도착 state를 비운다', async () => {
    show('/play?song=1&chart=12', { autoStart: true });
    await waitFor(() => expect(playing()).toBe(true));
    expect(screen.queryByRole('dialog', { name: '시험곡' })).toBeNull();
    expect(loadChart).toHaveBeenCalledWith({ songId: 1, chartId: 12 }, expect.any(AbortSignal));
    expect(where()).toBe('/play?song=1&chart=12');
    expect(screen.getByTestId('state').textContent).toBe('null');
  });

  it('state.autoStart가 있어도 주소에 곡·단계가 없으면 시작하지 않는다', async () => {
    show('/play', { autoStart: true });
    await screen.findByRole('complementary', { name: '선택한 곡' });
    expect(loadChart).not.toHaveBeenCalled();
    expect(playing()).toBe(false);
  });

  it('불러오는 동안 팝업 없이 카드의 ▶ 플레이가 스피너다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.mocked(loadChart).mockImplementation(async ({ chartId }) => {
      await gate;
      return { chart: { ...BUILTIN_CHARTS[0], title: '시험곡', chartId, songNumericId: 1, chartVersionId: chartId + 100 }, assets: null };
    });
    show();
    await clickCardPlay();
    const card = document.querySelector('.play-sd') as HTMLElement;
    await waitFor(() => expect(card.querySelector('.play-sd-play .spinner')).not.toBeNull());
    expect((card.querySelector('.play-sd-play') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(playing()).toBe(true));
  });

  it('기기가 준비되지 않으면 기기 준비 팝업이 뜨고, 이어지면 ▶ 플레이가 나타나며 자동으로 시작하지 않는다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    show();
    await clickCardPlay();
    const setup = await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    expect(within(setup).queryByRole('button', { name: '플레이' })).toBeNull();
    expect(where()).toBe('/play?song=1&chart=11');
    useLive.setState({ connected: [true, true] });
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    // 옵션 줄은 없다
    expect(within(dialog).queryByRole('group', { name: '연주 옵션' })).toBeNull();
    expect(playing()).toBe(false);
    fireEvent.click(await within(dialog).findByRole('button', { name: '플레이' }));
    await waitFor(() => expect(playing()).toBe(true));
    expect(where()).toBe('/play?song=1&chart=11');
  });

  it('팝업이 뜬 뒤 Enter로도 시작한다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    show();
    await clickCardPlay();
    await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    useLive.setState({ connected: [true, true] });
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    await within(dialog).findByRole('button', { name: '플레이' });
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(playing()).toBe(true));
  });

  it('[드럼 세팅으로]의 returnTo는 start 없는 주소다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    show();
    await clickCardPlay();
    const dialog = await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    fireEvent.click(within(dialog).getByRole('button', { name: '드럼 세팅으로' }));
    await screen.findByText('세팅 화면');
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}').returnTo).toBe('/play?song=1&chart=11');
  });

  it('취소하면 팝업이 닫히고 곡·단계 선택이 남으며 기기가 이어져도 자동 시작하지 않는다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'HARD' }));
    await clickCardPlay();
    const dialog = await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    useLive.setState({ connected: [true, true] });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(playing()).toBe(false);
    expect(where()).toBe('/play?song=1&chart=12');
    expect(screen.getByRole('radio', { name: 'HARD' }).getAttribute('aria-checked')).toBe('true');
  });

  it('채보를 못 읽으면 오류 팝업과 [다시 시도]가 뜨고, 다시 읽은 뒤에는 팝업의 [플레이]를 기다린다', async () => {
    vi.mocked(loadChart).mockRejectedValueOnce(new Error('채보 오류'));
    show();
    await clickCardPlay();
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toContain('채보 오류');
    expect(within(dialog).queryByRole('group', { name: '연주 옵션' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 시도' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '플레이' }));
    await waitFor(() => expect(playing()).toBe(true));
  });

  it('반주를 못 읽으면 오류 문구와 [다시 시도]가 팝업에 보이고 반주 끄기 안내는 없다', async () => {
    accLoad().mockRejectedValueOnce(new Error('반주 오류'));
    show();
    await clickCardPlay();
    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('반주 오류');
    expect(alert.textContent).not.toContain('반주를 끄면');
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 시도' }));
    await within(dialog).findByRole('button', { name: '플레이' });
  });

  it('서버 최고 기록을 못 읽어도 시작을 막지 않고 창 쪽 안내도 없다', async () => {
    vi.mocked(getBestRecords).mockRejectedValue(new Error('offline'));
    show();
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('PlayPage 기기 시각 차이 경고 (PLAY-006)', () => {
  it('경고 중이면 기기가 준비돼도 자동 시작하지 않고 시작 창에 문구를 보이며, [플레이]로 그대로 시작한다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    useLive.setState({ connected: [true, true], clockSkew: { spreadMs: 40, medians: { left: 50, right: 10, pedal: null }, outlier: null } });
    show();
    await clickCardPlay();
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    expect(within(dialog).getByText('스틱 시간이 서로 어긋났어요. 스틱을 껐다 켜 주세요.')).toBeTruthy();
    expect(playing()).toBe(false);
    fireEvent.click(await within(dialog).findByRole('button', { name: '플레이' }));
    await waitFor(() => expect(playing()).toBe(true));
  });
});

describe('PlayPage 게임의 메트로놈·녹음', () => {
  it('메트로놈 설정이 켜져 있어도 곡 중 클릭은 내지 않는다(clickOn false)', async () => {
    useSettings.setState({ metronome: true });
    show();
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(clock.deps).not.toBeNull();
    expect(clock.deps!.clickOn()).toBe(false);
  });

  it('녹음 대기 상태로 들어와도 녹음을 시작하지 않고 곡이 끝나도 저장 단계로 가지 않는다', async () => {
    toggleArm();
    expect(useRecordingStore.getState().phase).toBe('armed');
    show();
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    // 연주 중 잠금도 걸지 않는다
    expect(useRecordingStore.getState().locked).toBe(false);
    await waitFor(() => expect(frame.current).not.toBeNull());
    await act(async () => frame.current?.(performance.now() + 3_600_000));
    await screen.findByText('결과 화면');
    const rec = useRecordingStore.getState();
    expect(rec.phase).toBe('armed');
    expect(rec.pending).toBeNull();
    expect(rec.free).toBeNull();
  });
});

describe('PlayPage 첫 연주 전 박자 맞추기 권유', () => {
  const rec = { measuredAt: 1, medianMs: -60, madMs: 8, pairs: 12, input: 'sensor' as const, outputLatencyMs: null, kick: null };
  const sensorReady = (over: Partial<ReturnType<typeof useSettings.getState>> = {}) => {
    useSettings.setState({ sensorKind: 'pointer', timingCal: null, timingCalPrompt: 'none', ...over });
    useLive.setState({ connected: [true, true] });
  };

  it('센서 + 기록 없음 + none: 연주 대신 대화상자가 뜨고 연주가 시작되지 않는다', async () => {
    sensorReady();
    show();
    await clickCardPlay();
    const dialog = await screen.findByRole('dialog', { name: '박자 맞추기' });
    expect(within(dialog).getByText('처음 한 번만 박자를 맞추면 판정이 정확해져요.')).toBeTruthy();
    expect(playing()).toBe(false);
    expect(clock.deps).toBeNull();
    expect(useSettings.getState().timingCalPrompt).toBe('none');
  });

  it('[나중에 하기]로 닫으면 skipped가 되고 곡 선택으로 돌아오며, 다시 시작하면 바로 연주한다', async () => {
    sensorReady();
    show();
    await clickCardPlay();
    const dialog = await screen.findByRole('dialog', { name: '박자 맞추기' });
    fireEvent.click(within(dialog).getByRole('button', { name: '나중에 하기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useSettings.getState().timingCalPrompt).toBe('skipped');
    // 자동으로 시작하지 않는다
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(playing()).toBe(false);
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('키보드 모드는 권하지 않고 바로 시작한다', async () => {
    useSettings.setState({ sensorKind: 'none', timingCal: null, timingCalPrompt: 'none' });
    show();
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(useSettings.getState().timingCalPrompt).toBe('none');
  });

  it.each([
    ['측정 기록이 있으면', { timingCal: rec, timingCalPrompt: 'none' as const }],
    ['skipped이면', { timingCalPrompt: 'skipped' as const }],
    ['done이면', { timingCalPrompt: 'done' as const }],
  ])('센서여도 %s 바로 시작한다', async (_name, over) => {
    sensorReady(over);
    show();
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(screen.queryByRole('dialog', { name: '박자 맞추기' })).toBeNull();
  });
});

describe('PlayPage 초보 판정 폭', () => {
  const finishAndLog = async () => {
    await waitFor(() => expect(frame.current).not.toBeNull());
    await act(async () => frame.current?.(performance.now() + 3_600_000));
    await screen.findByText('결과 화면');
    return loadPlayLogs()[0];
  };

  it('EASY 채보는 세션·플레이 로그의 GOOD이 90ms다(PERFECT는 그대로)', async () => {
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'EASY' }));
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(clock.session?.windows).toEqual({ perfectMs: 25, goodMs: 90 });
    expect((await finishAndLog()).timing).toEqual({ perfectMs: 25, goodMs: 90 });
  });

  it('그 밖의 난이도는 설정 값 60ms 그대로다', async () => {
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'HARD' }));
    await clickCardPlay();
    await waitFor(() => expect(playing()).toBe(true));
    expect(clock.session?.windows).toEqual({ perfectMs: 25, goodMs: 60 });
    expect((await finishAndLog()).timing).toEqual({ perfectMs: 25, goodMs: 60 });
  });
});
