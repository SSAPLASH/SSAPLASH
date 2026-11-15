// @vitest-environment happy-dom
// 악보 연습 시작 확인 창 페이지 통합 테스트 (설계 MODE-001-MODE-003-picker-quick-start 4장).
// 실제 SheetPage·SongPicker·StartDialog를 그리고 네트워크·음향·캔버스 경계만 대체한다.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { getBestRecords } from '@/api/play/plays';
import { listSongs } from '@/api/song/songs';
import { useLive } from '@/store/liveStore';
import { loadChart, useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { useSettings } from '@/store/settingsStore';
import { useLessons } from '@/store/lessonStore';
import { practiceRateKey, usePracticeRate } from '@/features/play/store/practiceRate';
import { lessonsFromDto } from '@/domain/play/lesson';
import { BUILTIN_CHARTS } from '@/domain/song/chart';
import type { UserMe } from '@/domain/account/auth';
import type { SongDetail } from '@/domain/song/songCatalog';
import { Accompaniment } from '@/audio/Accompaniment';
import { SheetPage } from './SheetPage';

vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
vi.mock('@/api/song/songs', async (orig) => ({ ...(await orig<typeof import('@/api/song/songs')>()), getSong: vi.fn(), listSongs: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await vi.mocked(listSongs)(p as never)).items) }));
vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn().mockResolvedValue({ requestId: '', strategy: '', items: [] }) }));
vi.mock('@/api/play/lessons', () => ({ fetchLessons: vi.fn(() => new Promise(() => {})), postLessonCompletion: vi.fn() }));
vi.mock('@/runtime/playSync', () => ({ usePlaySync: create(() => ({ states: {} })), startPlaySync: vi.fn() }));
vi.mock('@/runtime/hitSound', async (orig) => ({ ...(await orig<typeof import('@/runtime/hitSound')>()), setSoundOnHit: vi.fn() }));
vi.mock('@/runtime/keyboardDrum', () => ({ setKeyboardDrum: vi.fn(), useKeyboardDrum: vi.fn() }));
vi.mock('@/runtime/audioUnlock', () => ({ unlockAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/play/components/stage/screenFit', () => ({ useScreenFits: () => true }));
vi.mock('@/components/drum/DrumKit', () => ({ DrumKit: () => null }));
vi.mock('@/features/play/components/stage/sheet/SheetPager', () => ({ SheetPager: () => null }));
// 안내 애니메이션의 rAF 갱신이 라우터 전환 렌더를 굶기지 않게 막는다
vi.mock('@/features/play/components/picker/guide/PickerGuide', () => ({ PickerGuide: () => null }));
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
  useSettings.setState({ sensorKind: 'none', countInBars: 0, firstSetupDone: true, accompaniment: true, timingCal: null, timingCalPrompt: 'done' });
  useLessons.getState().resetForTest();
  vi.mocked(Accompaniment as never as { load: ReturnType<typeof vi.fn> }).load?.mockClear?.();
});
afterEach(() => {
  cleanup();
  useLive.setState({ connected: [false, false], clockSkew: null });
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
    // 창은 연주 단계가 되면 바로 닫히고, 주소의 start는 begin()이 끝난 뒤 지운다 — 주소는 따로 기다린다
    await waitFor(() => expect(where()).toBe('/sheet?song=1&chart=12'));
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

  it('기기 시각 차이 경고 중이면 시작 창에 문구가 보인다(PLAY-006)', async () => {
    useLive.setState({ clockSkew: { spreadMs: 40, medians: { left: 10, right: 10, pedal: 50 }, outlier: 'pedal' } });
    show('/sheet?song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    expect(within(dialog).getByText('페달 시간이 어긋났어요. 껐다 켜 주세요.')).toBeTruthy();
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

// 설계 SETUP-학습-코스-자동-넘김 3-3·3-4: 레슨을 통과해 자동으로 넘어온 주소(auto=1)는 조건이 맞으면 플레이를 누르지 않아도 시작한다
describe('SheetPage 자동 시작(auto=1)', () => {
  /** 채보 12를 연주 레슨으로 둔 레슨 목록 */
  const lessonOn = (chartId: number) =>
    useLessons.setState({
      status: 'ready',
      list: lessonsFromDto({
        passAccuracy: 70,
        items: [{ order: 1, course: 'BEGINNER', kind: 'PLAY', songId: 1, chartId, title: '입문 · 시험', summary: 's', pads: ['KICK'], guide: true, bpm: 70, durationMs: 1000, noteCount: 4, bestAccuracy: null, passed: false, locked: false }],
      }),
    });
  const URL = '/sheet?tab=lessons&course=beginner&song=1&chart=12&start=1&auto=1';

  beforeEach(() => {
    useSettings.setState({ countInBars: 1 });
    lessonOn(12);
  });

  it('레슨 채보이고 기기·카운트다운 조건이 맞으면 누르지 않아도 시작하고 주소에서 start·auto가 빠진다', async () => {
    show(URL);
    await waitFor(() => expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=1&chart=12'));
    expect(screen.queryByRole('dialog', { name: '시험곡' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '선택한 곡' })).toBeNull();
  });

  it('불러오는 동안에는 시작 확인 창·곡 선택 대신 준비 화면만 보인다(화면이 잠깐 바뀌어 보이지 않게)', async () => {
    vi.mocked(loadChart).mockImplementation(() => new Promise(() => {}));
    show(URL);
    expect(await screen.findByText('다음 레슨을 준비하고 있어요')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '곡 범위' })).toBeNull();
  });

  it('자동 시작이 끝내 시작하지 못하면(오디오 준비 실패 등) 준비 화면에 갇히지 않고 시작 확인 창으로 돌아온다', async () => {
    const { unlockAudio } = await import('@/runtime/audioUnlock');
    vi.mocked(unlockAudio).mockRejectedValueOnce(new Error('blocked'));
    show(URL);
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    await within(dialog).findByRole('button', { name: '플레이' });
    await waitFor(() => expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=1&chart=12&start=1'));
    expect(screen.queryByText('다음 레슨을 준비하고 있어요')).toBeNull();
  });

  it('설정에서 카운트다운을 꺼 두었으면 시작하지 않고 창이 남는다. auto는 주소에서 지운다', async () => {
    useSettings.setState({ countInBars: 0 });
    show(URL);
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    await within(dialog).findByRole('button', { name: '플레이' });
    await waitFor(() => expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=1&chart=12&start=1'));
    expect(within(dialog).queryByText(/준비되면 바로 시작해요/)).toBeNull();
  });

  it('레슨이 아닌 채보는 auto=1이어도 시작하지 않는다', async () => {
    lessonOn(999);
    show('/sheet?song=1&chart=12&start=1&auto=1');
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    await within(dialog).findByRole('button', { name: '플레이' });
    await waitFor(() => expect(where()).toBe('/sheet?song=1&chart=12&start=1'));
  });

  it('기기가 준비되지 않았으면 기기 준비 창에서 멈추고, 그 뒤 연결해도 저절로 시작하지 않는다', async () => {
    useSettings.setState({ sensorKind: 'pointer' });
    show(URL);
    await screen.findByRole('dialog', { name: '기기 준비가 필요해요' });
    await waitFor(() => expect(where()).not.toContain('auto=1'));
    useLive.setState({ connected: [true, true] });
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    await within(dialog).findByRole('button', { name: '플레이' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('dialog', { name: '시험곡' })).toBeTruthy();
    expect(where()).toContain('start=1');
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
    expect(screen.getByRole('switch', { name: '반주' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('SheetPage 곡 범위 버튼과 사이드바 하위 메뉴 (설계 MODE-003-악보-연습-하위-메뉴, SETUP-학습-코스-중급 4-4)', () => {
  /** 화면 폭을 가장한다. 테스트 환경의 기본 폭(1024)은 태블릿(사이드바 강제 접힘)으로 잡힌다 */
  const viewport = (tablet: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: tablet && query === '(max-width: 1024px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  afterEach(() => {
    vi.unstubAllGlobals();
    useSettings.setState({ sidebarCollapsed: false });
  });

  it('사이드바가 펼쳐져 있어도 화면 위 버튼이 있다(11/13 요청으로 다시 둔다)', async () => {
    viewport(false);
    useSettings.setState({ sidebarCollapsed: false });
    show('/sheet');
    await screen.findAllByText('시험곡');
    expect(screen.getByRole('radiogroup', { name: '곡 범위' })).toBeTruthy();
  });

  it('사이드바를 접어 두었으면 화면 위 탭이 있다', async () => {
    viewport(false);
    useSettings.setState({ sidebarCollapsed: true });
    show('/sheet');
    await screen.findAllByText('시험곡');
    expect(screen.getByRole('radiogroup', { name: '곡 범위' })).toBeTruthy();
  });

  it('태블릿 폭(1024px 이하)이면 사이드바가 접히므로 화면 위 탭이 있다', async () => {
    viewport(true);
    useSettings.setState({ sidebarCollapsed: false });
    show('/sheet');
    await screen.findAllByText('시험곡');
    expect(screen.getByRole('radiogroup', { name: '곡 범위' })).toBeTruthy();
  });
});

describe('SheetPage 첫 연주 전 박자 맞추기 권유', () => {
  const sensorReady = (over: Partial<ReturnType<typeof useSettings.getState>> = {}) => {
    useSettings.setState({ sensorKind: 'pointer', timingCal: null, timingCalPrompt: 'none', ...over });
    useLive.setState({ connected: [true, true] });
  };

  it('센서 + 기록 없음 + none: [플레이]를 누르면 시작 대신 대화상자가 뜨고 시작 확인 창은 잠시 물러난다', async () => {
    sensorReady();
    show('/sheet?song=1&chart=12&start=1');
    const start = await screen.findByRole('dialog', { name: '시험곡' });
    fireEvent.click(await within(start).findByRole('button', { name: '플레이' }));
    const cal = await screen.findByRole('dialog', { name: '박자 맞추기' });
    expect(within(cal).getByText('처음 한 번만 박자를 맞추면 판정이 정확해져요.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '시험곡' })).toBeNull();
    // 연주는 시작되지 않았다(곡 선택이 남아 있고 주소의 start도 그대로)
    expect(screen.getByRole('complementary', { name: '선택한 곡' })).toBeTruthy();
    expect(where()).toContain('start=1');
  });

  it('[나중에 하기]로 닫으면 skipped가 되고 시작 확인 창으로 돌아오며, 다시 [플레이]하면 바로 시작한다', async () => {
    sensorReady();
    show('/sheet?song=1&chart=12&start=1');
    fireEvent.click(await within(await screen.findByRole('dialog', { name: '시험곡' })).findByRole('button', { name: '플레이' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '박자 맞추기' })).getByRole('button', { name: '나중에 하기' }));
    expect(useSettings.getState().timingCalPrompt).toBe('skipped');
    const start = await screen.findByRole('dialog', { name: '시험곡' });
    expect(screen.getByRole('complementary', { name: '선택한 곡' })).toBeTruthy();
    fireEvent.click(await within(start).findByRole('button', { name: '플레이' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '선택한 곡' })).toBeNull());
    expect(screen.queryByRole('dialog', { name: '박자 맞추기' })).toBeNull();
  });

  it.each([
    ['키보드 모드', { sensorKind: 'none' as const }],
    ['측정 기록이 있으면', { timingCal: { measuredAt: 1, medianMs: -60, madMs: 8, pairs: 12, input: 'sensor' as const, outputLatencyMs: null, kick: null } }],
    ['skipped이면', { timingCalPrompt: 'skipped' as const }],
    ['done이면', { timingCalPrompt: 'done' as const }],
  ])('%s 바로 시작한다', async (_name, over) => {
    sensorReady(over);
    show('/sheet?song=1&chart=12&start=1');
    fireEvent.click(await within(await screen.findByRole('dialog', { name: '시험곡' })).findByRole('button', { name: '플레이' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '선택한 곡' })).toBeNull());
    expect(screen.queryByRole('dialog', { name: '박자 맞추기' })).toBeNull();
  });
});

// 설계 MODE-003-practice-speed D17: 학습 코스의 연주 레슨은 통과가 원래 빠르기 기록만 세므로 속도를 고르지 않는다
describe('SheetPage 시작 확인 창의 연습 속도', () => {
  const lessonOn = (chartId: number) =>
    useLessons.setState({
      status: 'ready',
      list: lessonsFromDto({
        passAccuracy: 70,
        items: [{ order: 1, course: 'BEGINNER', kind: 'PLAY', songId: 1, chartId, title: '레슨', summary: 's', pads: ['KICK'], guide: true, bpm: 70, durationMs: 1000, noteCount: 4, bestAccuracy: null, passed: false, locked: false }],
      }),
    });

  beforeEach(() => {
    useSettings.setState({ accompaniment: false });
  });
  afterEach(() => {
    usePracticeRate.setState({ key: null, rate: 1 });
  });

  it('레슨이 아닌 채보는 반주가 꺼져 있으면 연습 속도를 고를 수 있다', async () => {
    lessonOn(999);
    show('/sheet?song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    expect(await within(dialog).findByRole('button', { name: '5% 느리게' })).toBeTruthy();
  });

  it('연주 레슨의 채보는 반주가 꺼져 있어도 연습 속도 줄이 없다', async () => {
    lessonOn(12);
    show('/sheet?tab=lessons&course=beginner&song=1&chart=12&start=1');
    const dialog = await screen.findByRole('dialog', { name: '시험곡' });
    await within(dialog).findByRole('button', { name: '플레이' });
    expect(within(dialog).queryByRole('button', { name: '5% 느리게' })).toBeNull();
    expect(within(dialog).queryByText('연습 속도')).toBeNull();
  });

  it('연주 레슨의 채보는 전에 골라 둔 속도가 있어도 원래 빠르기로 시작한다', async () => {
    usePracticeRate.getState().setRate(practiceRateKey(1, 12)!, 0.7);
    lessonOn(12);
    show('/sheet?tab=lessons&course=beginner&song=1&chart=12&start=1');
    fireEvent.click(await within(await screen.findByRole('dialog', { name: '시험곡' })).findByRole('button', { name: '플레이' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '선택한 곡' })).toBeNull());
    expect(screen.queryByText('70%')).toBeNull();
  });
});

describe('SheetPage 시작 확인 창의 판정 여유', () => {
  it('EASY 채보는 「판정 여유 ±90ms」를 보인다', async () => {
    show('/sheet?song=1&chart=11&start=1');
    expect(await screen.findByText('판정 여유 ±90ms')).toBeTruthy();
  });

  it('EASY가 아니면 보이지 않는다', async () => {
    show('/sheet?song=1&chart=12&start=1');
    await screen.findByRole('button', { name: '플레이' });
    expect(screen.queryByText(/판정 여유/)).toBeNull();
  });

  it('입문 코스 연주 레슨의 채보는 난이도와 상관없이 보인다', async () => {
    useLessons.setState({
      status: 'ready',
      list: lessonsFromDto({
        passAccuracy: 70,
        items: [{ order: 1, kind: 'PLAY', songId: 1, chartId: 12, title: '레슨', summary: 's', pads: ['KICK'], guide: true, bpm: 70, durationMs: 1000, noteCount: 4, bestAccuracy: null, passed: false, locked: false }],
      }),
    });
    show('/sheet?song=1&chart=12&start=1');
    expect(await screen.findByText('판정 여유 ±90ms')).toBeTruthy();
  });

  it('사용자 GOOD이 이미 90ms 이상이면 보이지 않는다', async () => {
    useSettings.setState({ timing: { perfectMs: 25, goodMs: 100 } });
    show('/sheet?song=1&chart=11&start=1');
    await screen.findByRole('button', { name: '플레이' });
    expect(screen.queryByText(/판정 여유/)).toBeNull();
    useSettings.setState({ timing: { perfectMs: 25, goodMs: 60 } });
  });
});
