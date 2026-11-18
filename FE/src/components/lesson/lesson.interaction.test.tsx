// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLessons } from '@/api/play/lessons';
import { fetchRecommendations } from '@/api/song/recommendations';
import { fetchSimilarSongs } from '@/api/song/similarSongs';
import { listSongs } from '@/api/song/songs';
import { getBestRecords } from '@/api/play/plays';
import type { UserMe } from '@/domain/account/auth';
import type { Lesson, LessonList } from '@/domain/play/lesson';
import type { PlayLog } from '@/domain/play/playLog';
import { useAuth } from '@/store/authStore';
import { useLessons } from '@/store/lessonStore';
import { useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import { queryClient } from '@/runtime/queryClient';
import { useChartParam } from '@/features/play/components/picker/useChartParam';
import { SongPicker } from '@/features/play/components/picker/SongPicker';
import { LessonCourse } from '@/features/play/components/picker/lesson/LessonCourse';
import { LessonInvite } from './LessonInvite';
import { LessonResultBand } from '@/features/result/components/LessonResultBand';

vi.mock('@/api/play/lessons', () => ({ fetchLessons: vi.fn(), postLessonCompletion: vi.fn() }));
vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));
vi.mock('@/api/song/songs', () => {
  const listSongs = vi.fn();
  return { listSongs, getSong: vi.fn(), listAllSongs: vi.fn(async (p: object) => (await listSongs(p)).items) };
});
vi.mock('@/api/play/plays', () => ({ getBestRecords: vi.fn() }));
// useChartParam이 주소의 채보를 읽으려 하므로 네트워크로 나가지 않게 막는다
vi.mock('@/api/song/charts', () => ({ getChartLatest: vi.fn(() => Promise.reject(new Error('test'))), getChartAssets: vi.fn(() => Promise.reject(new Error('test'))) }));
// 연주 데이터가 필요 없는 그림이라 실제 드럼 킷 대신 밝힌 패드만 적는다
vi.mock('@/components/drum/DrumKit', () => ({
  DrumKit: ({ states }: { states?: Record<string, string> }) => <div data-testid="kit">{Object.keys(states ?? {}).join(',')}</div>,
}));

const lesson = (order: number, over: Partial<Lesson> = {}): Lesson => ({
  order,
  course: 'BEGINNER',
  kind: 'PLAY',
  songId: 100 + order,
  chartId: 200 + order,
  title: `레슨 ${order}`,
  summary: `설명 ${order}`,
  pads: ['KICK'],
  guide: true,
  bpm: 70,
  durationMs: 13714,
  noteCount: 16,
  bestAccuracy: null,
  passed: false,
  locked: order > 1,
  ...over,
});
const course = (items: Lesson[]): LessonList => ({ passAccuracy: 70, items });
/** 중급 레슨(곡 300번대·채보 400번대). 1번은 알아보기 */
const mid = (order: number, over: Partial<Lesson> = {}): Lesson =>
  lesson(order, { course: 'INTERMEDIATE', kind: order === 1 ? 'READ' : 'PLAY', songId: 300 + order, chartId: 400 + order, title: `중급 · 중급 ${order}`, locked: true, ...over });

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function at(path: string, ui: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<>{ui}<Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // 저장소가 없는 환경
  }
  useLessons.getState().resetForTest();
  vi.mocked(fetchLessons).mockReset();
  vi.mocked(getBestRecords).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(listSongs).mockReset().mockResolvedValue({ items: [], hasNext: false });
  vi.mocked(fetchRecommendations).mockReset().mockResolvedValue({ requestId: 'r1', strategy: 's', items: [] });
  vi.mocked(fetchSimilarSongs).mockReset().mockResolvedValue({ requestId: 's1', strategy: 's', items: [] });
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated', user: { id: 1 } as UserMe });
  queryClient.clear();
  useSongs.setState({ source: 'api', scope: 'BUILTIN' });
});
afterEach(() => {
  cleanup();
  useAuth.setState({ status: 'unknown', user: null });
});

describe('곡 선택의 [학습 코스] 버튼', () => {
  it('악보 연습에만 있고 리듬 게임·로그인 전에는 없다', async () => {
    at('/sheet', <SongPicker mode="sheet" onStart={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '내 곡', 'AI 추천곡', '학습 코스']));
    cleanup();
    at('/play', <SongPicker mode="play" onStart={vi.fn()} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).not.toContain('학습 코스');
    cleanup();
    useAuth.setState({ status: 'anonymous', user: null });
    at('/sheet', <SongPicker mode="sheet" onStart={vi.fn()} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['기본 곡', '내 곡']);
    expect(fetchLessons).not.toHaveBeenCalled();
  });

  it('?tab=lessons로 열면 학습 코스이고, 범위를 바꾸면 주소에서 빠진다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1), lesson(2)]));
    at('/sheet?tab=lessons', <SongPicker mode="sheet" onStart={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '1. 레슨 1' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '기본 곡' }));
    await waitFor(() => expect(where()).toBe('/sheet'));
    fireEvent.click(screen.getByRole('radio', { name: '학습 코스' }));
    await waitFor(() => expect(where()).toBe('/sheet?tab=lessons'));
  });
});

describe('주소가 바뀌면 탭이 따라간다 (검증 추가 발견 1)', () => {
  function Nav() {
    const navigate = useNavigate();
    return (
      <>
        <button onClick={() => navigate('/sheet?tab=lessons')}>코스로 가기</button>
        <button onClick={() => navigate('/sheet')}>악보 연습 메뉴</button>
      </>
    );
  }

  it('곡 선택이 떠 있는 동안 ?tab=lessons로 바뀌면 학습 코스, tab이 빠지면 기본 곡', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1)]));
    at('/sheet', <><Nav /><SongPicker mode="sheet" onStart={vi.fn()} /></>);
    await waitFor(() => expect(screen.getByRole('radio', { name: '기본 곡' }).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: '코스로 가기' }));
    expect(await screen.findByRole('heading', { name: '1. 레슨 1' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '학습 코스' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '악보 연습 메뉴' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: '기본 곡' }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByRole('heading', { name: '1. 레슨 1' })).toBeNull();
  });
});

describe('학습 코스 본문(입문 코스만 있을 때)', () => {
  it('통과·도전 가능·잠김을 보이고, 처음에는 도전할 스테이지 카드가 열린다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(
      course([lesson(1, { passed: true, bestAccuracy: 91.2 }), lesson(2, { pads: ['KICK', 'SNARE'], locked: false }), lesson(3)]),
    );
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '2. 레슨 2' })).toBeTruthy();
    expect(screen.getByText('3개 중 1개 통과')).toBeTruthy();
    expect(screen.getByRole('button', { name: /1번 레슨 1, 연주 · 통과 91.2%/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /2번 레슨 2, 연주 · 도전 가능/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /3번 레슨 3, 연주 · 잠김/ })).toBeTruthy();
    // 악보와 드럼 그림은 레슨 패드만 보인다(「새로 배워요」 표시는 11/10 사용자 결정으로 뺐다)
    expect(screen.queryByText('새로 배워요')).toBeNull();
    expect(screen.getByRole('img', { name: '악보 위치: 킥, 스네어' })).toBeTruthy();
    expect(screen.getByTestId('kit').textContent).toBe('KICK,SNARE');
  });

  it('잠긴 스테이지는 눌러도 카드가 바뀌지 않고, 통과한 스테이지는 다시 연습할 수 있다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), lesson(2, { locked: false }), lesson(3)]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    await screen.findByRole('heading', { name: '2. 레슨 2' });
    fireEvent.click(screen.getByRole('button', { name: /3번 레슨 3/ }));
    expect(screen.getByRole('heading', { name: '2. 레슨 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /1번 레슨 1/ }));
    expect(screen.getByRole('heading', { name: '1. 레슨 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '플레이' })).toBeTruthy();
  });

  it('연주 레슨의 [플레이]는 탭을 유지한 악보 연습(시작 확인 창), 알아보기 레슨의 [레슨 시작하기]는 알아보기 화면으로 간다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { kind: 'READ' }), lesson(2)]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '레슨 시작하기' }));
    expect(where()).toBe('/sheet/lesson/101');
    cleanup();
    useLessons.getState().resetForTest();
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { kind: 'READ', passed: true }), lesson(2, { locked: false })]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '플레이' }));
    expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=102&chart=202&start=1');
  });

  it('이번 접속에서 통과한 레슨은 서버 반영 전이어도 다음 스테이지를 연다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1), lesson(2)]));
    useLessons.getState().markPassed(101);
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '2. 레슨 2' })).toBeTruthy();
  });

  it('모두 통과하면 완료 카드, 불러오기 실패는 다시 시도, 0개면 준비 중 안내', async () => {
    const open = vi.fn();
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true })]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={open} />);
    fireEvent.click(await screen.findByRole('button', { name: '기본 곡 보러 가기' }));
    expect(open).toHaveBeenCalled();
    cleanup();
    useLessons.getState().resetForTest();
    vi.mocked(fetchLessons).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(course([]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={open} />);
    fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('학습 코스를 준비하고 있어요')).toBeTruthy();
  });
});

describe('결과 화면 학습 코스 띠', () => {
  const log = (chartId: number | null, score: number, mode: PlayLog['mode'] = 'SHEET') =>
    ({ mode, chartId, sourceNoteCount: 20, notes: new Array(20).fill({}), summary: { score } }) as unknown as PlayLog;

  beforeEach(() => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1), lesson(2), lesson(3)]));
  });

  it('70% 이상이면 통과와 [다음 레슨], 이번 접속 진도에 더한다', async () => {
    at('/result/x', <LessonResultBand log={log(202, 1400)} />);
    const band = await screen.findByRole('status');
    expect(within(band).getByText('통과!')).toBeTruthy();
    expect(useLessons.getState().localPassed.has(102)).toBe(true);
    fireEvent.click(within(band).getByRole('button', { name: '다음 레슨' }));
    expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=103&chart=203&start=1');
  });

  it('70% 미만이면 재도전 안내와 [코스로]만(다시 하기는 결과 화면 아래 버튼이 맡는다), 마지막 레슨 통과는 [코스로]만', async () => {
    at('/result/x', <LessonResultBand log={log(202, 1399)} />);
    const band = await screen.findByRole('status');
    expect(within(band).getByText('정확도 70%를 넘기면 통과예요.')).toBeTruthy();
    expect(within(band).queryByRole('button', { name: '다시 하기' })).toBeNull();
    expect(within(band).getByRole('button', { name: '코스로' })).toBeTruthy();
    expect(useLessons.getState().localPassed.size).toBe(0);
    cleanup();
    at('/result/x', <LessonResultBand log={log(203, 2000)} />);
    const last = await screen.findByRole('status');
    expect(within(last).getByText('입문 코스를 모두 마쳤어요.')).toBeTruthy();
    expect(within(last).queryByRole('button', { name: '다음 레슨' })).toBeNull();
    fireEvent.click(within(last).getByRole('button', { name: '코스로' }));
    expect(where()).toBe('/sheet?tab=lessons&course=beginner');
  });

  it('입문 마지막 레슨을 통과하면 중급 코스가 열렸다고 알리고 [중급 코스로]', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1), lesson(2), mid(1), mid(2)]));
    at('/result/x', <LessonResultBand log={log(202, 2000)} />);
    const band = await screen.findByRole('status');
    expect(within(band).getByText('입문 코스를 모두 마쳤어요. 중급 코스가 열렸어요.')).toBeTruthy();
    expect(within(band).queryByRole('button', { name: '다음 레슨' })).toBeNull();
    fireEvent.click(within(band).getByRole('button', { name: '중급 코스로' }));
    expect(where()).toBe('/sheet?tab=lessons&course=intermediate');
  });

  it('중급 레슨의 다음 레슨·다시 하기는 중급 코스 주소다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), mid(1), mid(2)]));
    at('/result/x', <LessonResultBand log={log(401, 2000)} />);
    fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: '다음 레슨' }));
    expect(where()).toBe('/sheet?tab=lessons&course=intermediate&song=302&chart=402&start=1');
  });

  it('레슨이 아닌 곡·리듬 게임 기록에는 띠가 없다', async () => {
    at('/result/x', <LessonResultBand log={log(999, 2000)} />);
    await waitFor(() => expect(useLessons.getState().status).toBe('ready'));
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    at('/result/x', <LessonResultBand log={log(202, 2000, 'RHYTHM')} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// 설계 SETUP-학습-코스-자동-넘김 4-1·4-3: 방금 친 결과(fresh)에서 통과하면 3초 뒤 다음 레슨으로 넘어간다
describe('결과 화면 띠의 자동 넘김', () => {
  const log = (playId: string, chartId: number, score: number) =>
    ({ playId, mode: 'SHEET', chartId, sourceNoteCount: 20, notes: new Array(20).fill({}), summary: { score } }) as unknown as PlayLog;
  const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1), lesson(2), lesson(3)]));
  });
  afterEach(() => vi.useRealTimers());

  it('통과하면 남은 초를 보이고 3초 뒤 다음 연주 레슨을 자동 시작 주소로 연다', async () => {
    at('/result/a1', <LessonResultBand log={log('a1', 202, 1400)} fresh />);
    const band = await screen.findByRole('status');
    expect(within(band).getByText('3초 뒤 다음 레슨으로 넘어가요.')).toBeTruthy();
    expect(within(band).getByRole('button', { name: '지금 가기' })).toBeTruthy();
    await pass(1000);
    expect(within(band).getByText('2초 뒤 다음 레슨으로 넘어가요.')).toBeTruthy();
    await pass(2000);
    expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=103&chart=203&start=1&auto=1');
  });

  it('[지금 가기]는 바로 간다', async () => {
    at('/result/a2', <LessonResultBand log={log('a2', 202, 1400)} fresh />);
    fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: '지금 가기' }));
    expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=103&chart=203&start=1&auto=1');
  });

  it('[머무르기]나 화면 조작이면 멈추고 [다음 레슨]·[코스로]가 남는다. 이때 [다음 레슨]은 자동 시작 없이 간다', async () => {
    at('/result/a3', <LessonResultBand log={log('a3', 202, 1400)} fresh />);
    const band = await screen.findByRole('status');
    fireEvent.click(within(band).getByRole('button', { name: '머무르기' }));
    expect(within(band).getByText('다음 스테이지가 열렸어요.')).toBeTruthy();
    await pass(5000);
    expect(where()).toBe('/result/a3');
    expect(within(band).getByRole('button', { name: '코스로' })).toBeTruthy();
    fireEvent.click(within(band).getByRole('button', { name: '다음 레슨' }));
    expect(where()).toBe('/sheet?tab=lessons&course=beginner&song=103&chart=203&start=1');
    cleanup();
    at('/result/a4', <LessonResultBand log={log('a4', 202, 1400)} fresh />);
    const again = await screen.findByRole('status');
    fireEvent.pointerDown(document.body);
    expect(within(again).queryByText(/초 뒤 다음 레슨/)).toBeNull();
    await pass(5000);
    expect(where()).toBe('/result/a4');
  });

  it('통과 못 함·코스 마지막 레슨·지난 결과(fresh 아님)는 세지 않는다', async () => {
    at('/result/b1', <LessonResultBand log={log('b1', 202, 1399)} fresh />);
    expect(within(await screen.findByRole('status')).queryByText(/초 뒤 다음 레슨/)).toBeNull();
    cleanup();
    at('/result/b2', <LessonResultBand log={log('b2', 203, 2000)} fresh />);
    expect(within(await screen.findByRole('status')).queryByText(/초 뒤 다음 레슨/)).toBeNull();
    cleanup();
    at('/result/b3', <LessonResultBand log={log('b3', 202, 1400)} />);
    const band = await screen.findByRole('status');
    expect(within(band).queryByText(/초 뒤 다음 레슨/)).toBeNull();
    await pass(5000);
    expect(where()).toBe('/result/b3');
  });

  it('같은 결과 화면으로 돌아오면(뒤로 가기) 다시 세지 않는다', async () => {
    at('/result/c1', <LessonResultBand log={log('c1', 202, 1400)} fresh />);
    await screen.findByText('3초 뒤 다음 레슨으로 넘어가요.');
    cleanup();
    at('/result/c1', <LessonResultBand log={log('c1', 202, 1400)} fresh />);
    const band = await screen.findByRole('status');
    expect(within(band).queryByText(/초 뒤 다음 레슨/)).toBeNull();
    expect(within(band).getByRole('button', { name: '다음 레슨' })).toBeTruthy();
  });
});

describe('권유 카드', () => {
  it('통과한 레슨이 없으면 보이고, [입문 코스 시작]은 탭으로 간다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1), lesson(2)]));
    at('/free', <LessonInvite />);
    fireEvent.click(await screen.findByRole('button', { name: '입문 코스 시작' }));
    expect(where()).toBe('/sheet?tab=lessons');
    expect(screen.queryByRole('region', { name: '입문 코스 안내' })).toBeNull();
  });

  it('닫으면 다시 열어도 보이지 않는다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1)]));
    at('/free', <LessonInvite />);
    fireEvent.click(await screen.findByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('region', { name: '입문 코스 안내' })).toBeNull();
    cleanup();
    useLessons.getState().resetForTest();
    at('/free', <LessonInvite />);
    await Promise.resolve();
    expect(screen.queryByRole('region', { name: '입문 코스 안내' })).toBeNull();
  });

  it('[입문 코스] 탭에 한 번 들어오면(카드 버튼이 아닌 길이어도) 나와도 다시 보이지 않는다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1), lesson(2)]));
    function Nav() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => navigate('/sheet?tab=lessons')}>사이드바 악보 연습 입문 코스</button>
          <button onClick={() => navigate('/free')}>자유 연습</button>
        </>
      );
    }
    function Page() {
      const { pathname } = useLocation();
      return pathname === '/sheet' ? <SongPicker mode="sheet" onStart={vi.fn()} /> : null;
    }
    at('/free', <><Nav /><LessonInvite /><Page /></>);
    expect(await screen.findByRole('region', { name: '입문 코스 안내' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '사이드바 악보 연습 입문 코스' }));
    expect(await screen.findByRole('heading', { name: '1. 레슨 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '자유 연습' }));
    await waitFor(() => expect(where()).toBe('/free'));
    expect(screen.queryByRole('region', { name: '입문 코스 안내' })).toBeNull();
    // 새로 고쳐도(브라우저에 기억) 다시 뜨지 않는다
    cleanup();
    useLessons.getState().resetForTest();
    at('/free', <LessonInvite />);
    await Promise.resolve();
    expect(screen.queryByRole('region', { name: '입문 코스 안내' })).toBeNull();
  });

  it('하나라도 통과했거나 로그인 전이면 보이지 않는다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), lesson(2)]));
    at('/free', <LessonInvite />);
    await waitFor(() => expect(useLessons.getState().status).toBe('ready'));
    expect(screen.queryByRole('region', { name: '입문 코스 안내' })).toBeNull();
    cleanup();
    useLessons.getState().resetForTest();
    useAuth.setState({ status: 'anonymous', user: null });
    at('/free', <LessonInvite />);
    expect(screen.queryByRole('region', { name: '입문 코스 안내' })).toBeNull();
    expect(fetchLessons).toHaveBeenCalledTimes(1);
  });
});

describe('곡·채보 주소를 바꿔도 학습 코스·고른 코스는 남는다', () => {
  function Probe() {
    const p = useChartParam();
    return (
      <>
        <button onClick={() => p.select(102, 202)}>고르기</button>
        <button onClick={() => p.clear()}>지우기</button>
      </>
    );
  }

  it('select·clear 모두 tab을 남긴다', () => {
    at('/sheet?tab=lessons', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: '고르기' }));
    expect(where()).toBe('/sheet?tab=lessons&song=102&chart=202');
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    expect(where()).toBe('/sheet?tab=lessons');
    cleanup();
    at('/sheet?tab=lessons&course=intermediate', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: '고르기' }));
    expect(where()).toBe('/sheet?tab=lessons&course=intermediate&song=102&chart=202');
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    expect(where()).toBe('/sheet?tab=lessons&course=intermediate');
    cleanup();
    at('/play', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: '고르기' }));
    expect(where()).toBe('/play?song=102&chart=202');
  });
});

// 학습 코스 설계 4-1·4-2절
describe('학습 코스: 입문·중급 코스 고르기', () => {
  const picker = () => screen.getByRole('group', { name: '코스 고르기' });
  const courseButton = (name: string) => within(picker()).getByRole('button', { name: new RegExp(`^${name}`) });

  it('코스 칸 두 개에 진도가 보이고, 입문이 남았으면 중급은 잠김이며 기본으로 입문이 보인다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), lesson(2, { locked: false }), mid(1), mid(2)]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '2. 레슨 2' })).toBeTruthy();
    expect(courseButton('입문 코스').getAttribute('aria-pressed')).toBe('true');
    expect(within(courseButton('입문 코스')).getByText('2개 중 1개 통과')).toBeTruthy();
    expect(within(courseButton('중급 코스')).getByText('입문 코스를 다 통과하면 열려요')).toBeTruthy();
  });

  it('잠긴 중급을 고르면 스테이지가 모두 잠김이고 [입문 코스 이어 하기]가 입문으로 돌린다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { locked: false }), mid(1), mid(2)]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    await screen.findByRole('heading', { name: '1. 레슨 1' });
    fireEvent.click(courseButton('중급 코스'));
    expect(where()).toBe('/sheet?tab=lessons&course=intermediate');
    expect(screen.getByRole('heading', { name: '입문 코스를 먼저 통과해요' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /1번 중급 1, 알아보기 · 잠김/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /2번 중급 2, 연주 · 잠김/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '입문 코스 이어 하기' }));
    expect(where()).toBe('/sheet?tab=lessons&course=beginner');
    expect(screen.getByRole('heading', { name: '1. 레슨 1' })).toBeTruthy();
  });

  it('주소에 코스가 없으면 도전할 레슨이 있는 코스가 보이고, 맵 아래 목표 문구가 코스마다 다르다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), mid(1, { locked: false }), mid(2)]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '1. 중급 1' })).toBeTruthy();
    expect(courseButton('중급 코스').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('여기까지 오면 드럼 아홉 개를 모두 칠 수 있어요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '레슨 시작하기' })).toBeTruthy();
  });

  it('입문을 다 통과하고 입문을 보면 완료 카드의 [중급 코스 시작하기]가 중급으로 바꾼다', async () => {
    const open = vi.fn();
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), mid(1, { locked: false })]));
    at('/sheet?tab=lessons&course=beginner', <LessonCourse onOpenBuiltin={open} />);
    expect(await screen.findByRole('heading', { name: '8비트를 칠 수 있게 됐어요' })).toBeTruthy();
    expect(within(courseButton('입문 코스')).getByText('코스 완료')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '기본 곡 보러 가기' }));
    expect(open).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '중급 코스 시작하기' }));
    expect(where()).toBe('/sheet?tab=lessons&course=intermediate');
    expect(screen.getByRole('heading', { name: '1. 중급 1' })).toBeTruthy();
  });

  it('중급까지 다 통과하면 중급 완료 카드', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), mid(1, { passed: true })]));
    at('/sheet?tab=lessons', <LessonCourse onOpenBuiltin={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '드럼 아홉 개를 모두 칠 수 있게 됐어요' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '중급 코스 시작하기' })).toBeNull();
  });

  it('중급 연주 레슨의 [플레이]는 중급 코스를 유지한다', async () => {
    vi.mocked(fetchLessons).mockResolvedValue(course([lesson(1, { passed: true }), mid(1, { kind: 'PLAY', locked: false })]));
    at('/sheet?tab=lessons&course=intermediate', <LessonCourse onOpenBuiltin={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '플레이' }));
    expect(where()).toBe('/sheet?tab=lessons&course=intermediate&song=301&chart=401&start=1');
  });
});
