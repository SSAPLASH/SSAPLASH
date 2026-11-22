// @vitest-environment happy-dom
// 리포트 하단 AI 추천 연습곡 (설계 COACH-004-song-recommend-report 4장). 요청 1회·파라미터·클릭 이동·숨김 조건.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations, postRecommendationClick } from '@/api/song/recommendations';
import { fetchSimilarSongs } from '@/api/song/similarSongs';
import { getPlayLog } from '@/engine/playLog';
import { loadAllReportNotes, prefetchReport, refreshReport } from '@/runtime/playSync';
import type { RecommendationItem } from '@/domain/song/recommendation';
import type { PlayLog } from '@/domain/play/playLog';
import type { Report } from '@/domain/play/report';
import type { SongSummary } from '@/domain/song/songCatalog';
import { useAuth } from '@/store/authStore';
import { useRecommendations } from '@/store/recommendationStore';
import { useSongs } from '@/store/songStore';
import { ReportPage } from './ReportPage';

// 인증 검사 스위치는 모듈 상수라 실행 중 env로 못 바꾼다. 끈 빌드 케이스만 이 플래그로 false가 된다
const flags = vi.hoisted(() => ({ authRequired: true }));
vi.mock('@/config/auth', () => ({
  get AUTH_REQUIRED() {
    return flags.authRequired;
  },
}));
vi.mock('@/api/song/recommendations', () => ({ fetchRecommendations: vi.fn(), postRecommendationClick: vi.fn() }));
vi.mock('@/api/song/similarSongs', () => ({ fetchSimilarSongs: vi.fn() }));
vi.mock('@/api/song/charts', () => ({ getChartAssets: vi.fn().mockResolvedValue({ accompanimentUrl: null }) }));
// 이 브라우저의 연주 기록. 기본은 없음(다른 기기에서 친 기록을 여는 경우와 같다)
vi.mock('@/engine/playLog', async (orig) => ({ ...(await orig<typeof import('@/engine/playLog')>()), getPlayLog: vi.fn() }));
vi.mock('@/runtime/playSync', async (orig) => ({
  ...(await orig<typeof import('@/runtime/playSync')>()),
  prefetchReport: vi.fn(),
  refreshReport: vi.fn(),
  loadAllReportNotes: vi.fn(),
}));

const song: SongSummary = {
  id: 77, title: '추천곡', artist: '가수', source: 'BUILTIN', status: 'READY', bpm: 100, timeSignature: '4/4', durationMs: 60000,
  hasAccompaniment: false, accompanimentStatus: 'NONE', songLevel: 'BEGINNER', difficulties: ['EASY'], createdAt: '', coverUrl: null, sheetId: null,
};
const recoItem: RecommendationItem = { song, chartId: 555, difficulty: 'EASY', reasons: [{ code: 'WEAK_PAD', text: 'x' }] };
const drillItem: RecommendationItem = { ...recoItem, song: { ...song, id: 99, title: '약점 연습곡' }, chartId: 777, difficulty: 'HARD', reasons: [{ code: 'DRILL_PAD', text: '스네어 연습 문구' }] };
const drillCalls = () => vi.mocked(fetchRecommendations).mock.calls.filter(([p]) => p.context === 'DRILL');
const reportCalls = () => vi.mocked(fetchRecommendations).mock.calls.filter(([p]) => p.context === 'REPORT');
const report = (over: Partial<Report> = {}): Report => ({
  playId: 'p1', score: 1, accuracy: 0.5, maxCombo: 1, counts: { PERFECT: 1, GOOD: 0, MISS: 0 }, histogram: null, padStats: [],
  mode: 'RHYTHM', songId: null, chartId: null, difficulty: null, inputSource: 'KEYBOARD', playbackRate: 1, analysisStatus: 'DONE', weakSegments: [], coachSummary: null, recommendedDrills: null,
  generatedAt: '', ...over,
});
const setReport = (r: Report | Error) =>
  vi.mocked(prefetchReport).mockReturnValue({ report: r instanceof Error ? Promise.reject(r) : Promise.resolve(r) } as ReturnType<typeof prefetchReport>);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
function show(path = '/result/p1/report') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/result/:playId/report" element={<ReportPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(prefetchReport).mockReset();
  setReport(report());
  vi.mocked(loadAllReportNotes).mockReset().mockResolvedValue([]);
  vi.mocked(getPlayLog).mockReset().mockReturnValue(null);
  vi.mocked(refreshReport).mockReset().mockResolvedValue(report());
  vi.mocked(fetchRecommendations).mockReset().mockImplementation(async (p) => p.context === 'DRILL'
    ? { requestId: 'drill1', strategy: 'DRILL_V1', items: [drillItem] }
    : { requestId: 'r1', strategy: 's', items: [recoItem] });
  vi.mocked(postRecommendationClick).mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchSimilarSongs).mockReset().mockResolvedValue({
    requestId: 's1', strategy: 'SIMILAR_V1',
    items: [{ song: { ...song, id: 88, title: '닮은곡' }, chartId: 600, difficulty: 'NORMAL', similarity: 0.9, matchedOn: ['TEMPO'] }],
  });
  useRecommendations.getState().resetForTest();
  useAuth.setState({ status: 'authenticated' });
  useSongs.setState({ source: 'api' });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); flags.authRequired = true; });

describe('리포트 하단 추천', () => {
  it('리포트 OK 뒤 REPORT 파라미터로 1회 요청하고 카드를 그린다', async () => {
    show();
    expect(await screen.findByText('추천 곡')).toBeTruthy();
    expect(screen.getByText('추천곡')).toBeTruthy();
    expect(reportCalls()).toHaveLength(1);
    expect(reportCalls()[0][0]).toEqual({ context: 'REPORT', mode: 'RHYTHM', playId: 'p1', size: 5 });
  });

  it('분석 상태가 PENDING·FAILED여도 보인다', async () => {
    setReport(report({ analysisStatus: 'FAILED' }));
    show();
    expect(await screen.findByText('추천 곡')).toBeTruthy();
  });

  it('SHEET 리포트는 mode=SHEET로 요청하고 /sheet로 이동한다', async () => {
    setReport(report({ mode: 'SHEET' }));
    show();
    fireEvent.click(await screen.findByText('추천곡'));
    expect(reportCalls()[0][0].mode).toBe('SHEET');
    expect((await screen.findByTestId('where')).textContent).toBe('/sheet?song=77&chart=555&start=1');
  });

  it('카드 클릭은 기록을 보내고 /play?song=&chart=로 이동한다', async () => {
    show();
    fireEvent.click(await screen.findByText('추천곡'));
    expect(postRecommendationClick).toHaveBeenCalledWith('r1', 77);
    expect((await screen.findByTestId('where')).textContent).toBe('/play?song=77&chart=555');
  });

  it('[다시 시도]로 재마운트돼도 요청은 1회다', async () => {
    // 첫 노트 로드 실패 → 노트 카드의 [다시 시도]가 ReportView를 재마운트한다
    vi.mocked(loadAllReportNotes).mockRejectedValueOnce(new Error('x'));
    show();
    await screen.findByText('추천 곡');
    fireEvent.click(await screen.findByText('다시 시도'));
    await waitFor(() => expect(prefetchReport).toHaveBeenCalledTimes(2));
    await screen.findByText('추천 곡');
    await screen.findByText('이 약점 연습하기');
    expect(reportCalls()).toHaveLength(1);
    expect(drillCalls()).toHaveLength(1);
  });

  it('폴링으로 리포트가 바뀌어도 요청은 1회다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setReport(report({ analysisStatus: 'PENDING' }));
      vi.mocked(refreshReport).mockResolvedValue(report({ analysisStatus: 'DONE' }));
      show();
      await screen.findByText('추천 곡');
      expect(drillCalls()).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
      await screen.findByText('이 약점 연습하기');
      expect(drillCalls()).toHaveLength(1);
      expect(refreshReport).toHaveBeenCalled();
      expect(reportCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('리포트 로드 실패면 요청이 없다', async () => {
    setReport(Object.assign(new Error('x'), { status: 404 }));
    show();
    await screen.findByText(/불러오지|없습니다/);
    expect(fetchRecommendations).not.toHaveBeenCalled();
    expect(screen.queryByText('추천 곡')).toBeNull();
  });

  it('내장 곡 빌드나 비인증이면 요청이 없다', async () => {
    useSongs.setState({ source: 'builtin' });
    show();
    await screen.findByLabelText('연주 요약');
    await waitFor(() => expect(loadAllReportNotes).toHaveBeenCalled());
    cleanup();
    useSongs.setState({ source: 'api' });
    useAuth.setState({ status: 'anonymous' });
    show();
    await screen.findByLabelText('연주 요약');
    expect(fetchRecommendations).not.toHaveBeenCalled();
  });

  it('추천이 비면 카드가 없다', async () => {
    vi.mocked(fetchRecommendations).mockResolvedValue({ requestId: 'r1', strategy: 's', items: [] });
    show();
    await waitFor(() => expect(fetchRecommendations).toHaveBeenCalled());
    expect(screen.queryByText('추천 곡')).toBeNull();
  });
});

describe('리포트 하단 비슷한 곡', () => {
  it('리포트에 songId가 없으면 요청도 카드도 없다', async () => {
    show();
    await screen.findByText('추천 곡');
    expect(fetchSimilarSongs).not.toHaveBeenCalled();
    expect(screen.queryByText('방금 친 곡과 비슷한 곡')).toBeNull();
  });

  it('songId가 있으면 추천 곡과 별도 카드로 1회 요청해 보인다', async () => {
    setReport(report({ songId: 12, chartId: 3, difficulty: 'HARD' }));
    show();
    expect(await screen.findByText('방금 친 곡과 비슷한 곡')).toBeTruthy();
    expect(screen.getByText('추천 곡')).toBeTruthy();
    expect(screen.getByText('템포가 비슷해요')).toBeTruthy();
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchSimilarSongs).mock.calls[0].slice(0, 2)).toEqual([12, { difficulty: 'HARD', size: 5 }]);
  });

  it('difficulty가 없으면 NORMAL로 요청한다', async () => {
    setReport(report({ songId: 12 }));
    show();
    await screen.findByText('방금 친 곡과 비슷한 곡');
    expect(vi.mocked(fetchSimilarSongs).mock.calls[0][1]).toEqual({ difficulty: undefined, size: 5 });
  });

  it('클릭하면 기록을 보내고 모드별 경로로 이동한다', async () => {
    setReport(report({ songId: 12, mode: 'SHEET' }));
    show();
    fireEvent.click(await screen.findByText('닮은곡'));
    expect(postRecommendationClick).toHaveBeenCalledWith('s1', 88);
    expect((await screen.findByTestId('where')).textContent).toBe('/sheet?song=88&chart=600&start=1');
  });

  it('[다시 시도] 재마운트에도 1회이고, 내장 곡·비인증이면 요청이 없다', async () => {
    setReport(report({ songId: 12 }));
    vi.mocked(loadAllReportNotes).mockRejectedValueOnce(new Error('x'));
    show();
    await screen.findByText('방금 친 곡과 비슷한 곡');
    fireEvent.click(await screen.findByText('다시 시도'));
    await waitFor(() => expect(prefetchReport).toHaveBeenCalledTimes(2));
    await screen.findByText('방금 친 곡과 비슷한 곡');
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
    cleanup();
    useAuth.setState({ status: 'anonymous' });
    show();
    await screen.findByLabelText('연주 요약');
    expect(fetchSimilarSongs).toHaveBeenCalledTimes(1);
  });

  it('비슷한 곡이 비어도 리포트·추천 곡은 정상이다', async () => {
    setReport(report({ songId: 12 }));
    vi.mocked(fetchSimilarSongs).mockResolvedValue({ requestId: 's', strategy: 'x', items: [] });
    show();
    await screen.findByText('추천 곡');
    await waitFor(() => expect(fetchSimilarSongs).toHaveBeenCalled());
    expect(screen.queryByText('방금 친 곡과 비슷한 곡')).toBeNull();
  });
});


describe('약점 연계 연습', () => {
  it('DONE에서 DRILL을 3곡 요청하고 약점 아래 서버 문구와 채보를 보존한다', async () => {
    show();
    expect(await screen.findByText('이 약점 연습하기')).toBeTruthy();
    expect(screen.getByText('스네어 연습 문구')).toBeTruthy();
    expect(drillCalls()[0][0]).toEqual({ context: 'DRILL', mode: 'RHYTHM', playId: 'p1', size: 3 });
    expect(screen.getByText('추천 곡')).toBeTruthy();
    vi.mocked(postRecommendationClick).mockRejectedValue(new Error('failed'));
    fireEvent.click(screen.getByText('약점 연습곡'));
    expect(postRecommendationClick).toHaveBeenCalledWith('drill1', 99);
    expect((await screen.findByTestId('where')).textContent).toBe('/play?song=99&chart=777');
  });

  it('인증 검사를 끈 빌드에서는 로그인 상태여도 DRILL을 조회하지 않는다', async () => {
    flags.authRequired = false;
    show();
    await screen.findByLabelText('연주 요약');
    await waitFor(() => expect(loadAllReportNotes).toHaveBeenCalled());
    expect(fetchRecommendations).not.toHaveBeenCalled();
  });

  it('FAILED에서는 DRILL을 조회하지 않는다', async () => {
    setReport(report({ analysisStatus: 'FAILED' }));
    show();
    await screen.findByText('추천 곡');
    expect(drillCalls()).toHaveLength(0);
    expect(screen.queryByText('이 약점 연습하기')).toBeNull();
  });

  it('StrictMode와 실제 재진입을 구분한다', async () => {
    const view = render(<StrictMode><MemoryRouter initialEntries={['/result/p1/report']}><Routes>
      <Route path="/result/:playId/report" element={<ReportPage />} />
    </Routes></MemoryRouter></StrictMode>);
    await screen.findByText('이 약점 연습하기');
    expect(drillCalls()).toHaveLength(1);
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    show();
    await screen.findByText('이 약점 연습하기');
    expect(drillCalls()).toHaveLength(2);
  });

  it.each(['empty', 'error'] as const)('%s 결과는 영역을 숨긴다', async (kind) => {
    vi.mocked(fetchRecommendations).mockImplementation(async (p) => {
      if (p.context !== 'DRILL') return { requestId: 'r', strategy: 's', items: [recoItem] };
      if (kind === 'error') throw new Error('failed');
      return { requestId: 'd', strategy: 's', items: [] };
    });
    show();
    await waitFor(() => expect(useRecommendations.getState().entries['DRILL:p1']?.status).toBe('hidden'));
    expect(screen.queryByText('이 약점 연습하기')).toBeNull();
  });
});

// 화면 구성 (설계 COACH-002 리포트 화면 개편 A1·A3·A4·A7·A9): 약점을 자리별로 나눠 그리고, 고른 구간으로 확대 영역이 바뀐다
describe('리포트 화면 구성', () => {
  it('짧은 곡(노트 20개 미만)이라 총평이 없으면 템플릿 한마디와 설명을 머리에 둔다', async () => {
    setReport(report({ counts: { PERFECT: 8, GOOD: 0, MISS: 0 } }));
    show();
    expect(await screen.findByText('짧은 곡을 깔끔하게 마쳤어요.')).toBeTruthy();
    expect(screen.getByText(/거의 놓치지 않고 박자를 잘 따라갔어요/)).toBeTruthy();
    expect(screen.queryByText('AI가 작성했어요')).toBeNull();
  });

  const N = (seq: number, timeMs: number, pad: 'KICK' | 'SNARE' | 'RIDE' | 'HIHAT', judgement: 'PERFECT' | 'GOOD' | 'MISS') => ({
    seq, noteId: null, timeMs, pad, judgement, deltaMs: judgement === 'MISS' ? null : -10, velocity: null,
  });
  const NOTES = [
    N(1, 13340, 'RIDE', 'MISS'), N(2, 14790, 'RIDE', 'MISS'), N(3, 15530, 'HIHAT', 'MISS'),
    N(4, 46000, 'KICK', 'PERFECT'), N(5, 46240, 'SNARE', 'MISS'), N(6, 46480, 'KICK', 'PERFECT'), N(7, 46720, 'SNARE', 'MISS'),
  ];
  const SEG = { causeTags: [], severity: 0.8, scope: 'SEGMENT' as const };
  const CLUSTER = { ...SEG, fromMs: 12300, toMs: 17300, pattern: 'MISS_CLUSTER', description: '이 구간에서 많이 놓쳐요.', pads: ['RIDE' as const], metrics: { missCount: 3, noteCount: 3, missRate: 1 } };
  const TRANSITION = {
    ...SEG, fromMs: 40000, toMs: 50000, pattern: 'TRANSITION_MISS', description: '킥에서 스네어로 넘어갈 때 100%를 놓쳐요.', pads: ['KICK' as const, 'SNARE' as const],
    metrics: { transitionCount: 6, missCount: 6, missRate: 1 },
  };
  const WHOLE = { ...SEG, scope: 'WHOLE' as const, fromMs: 0, toMs: 50000, pattern: 'TIMING_LATE', description: '전반적으로 조금 늦게 쳐요.', pads: [], metrics: {} };
  const headline = () => screen.getByRole('heading', { level: 2, name: /확인|연습/ }).textContent;

  beforeEach(() => {
    useAuth.setState({ status: 'anonymous' });
    vi.mocked(loadAllReportNotes).mockResolvedValue(NOTES);
  });

  it('머리말·요약 수치가 보이고, 처음에는 첫 놓친 구간이 확대된다', async () => {
    setReport(report({ accuracy: 0.383, maxCombo: 24, score: 26320, weakSegments: [WHOLE, TRANSITION, CLUSTER] }));
    show();
    // 짧은 판이라 머리 제목은 템플릿 총평이다. 곡 정보는 메타 줄에 있다
    expect(await screen.findByText('리듬 게임 · 키보드')).toBeTruthy();
    expect(screen.getByLabelText('연주 요약').textContent).toContain('38.3%');
    await waitFor(() => expect(headline()).toBe('0:12–0:17놓친 노트 확인'));
    expect(screen.getByText('노트 3개 중 3개 놓침 · 100%')).toBeTruthy();
    expect(screen.getByText('이 구간에서 많이 놓쳐요.')).toBeTruthy();
  });

  it('이 브라우저에 연주 기록이 있으면 구간 시각 앞에 마디가 붙고, 5초 칸은 시각만이다(설계 COACH-002-report-timing-direction D8·D9)', async () => {
    // BPM 120·4박·원점 0 — 한 마디 2초
    const log = { title: '곡', difficulty: 'EASY', mode: 'SHEET', startedAt: '2026-11-15T00:00:00.000Z', durationMs: 60000, timing: { perfectMs: 25, goodMs: 60 }, bpm: 120, beatsPerBar: 4, offsetMs: 0, hits: [], notes: [] };
    vi.mocked(getPlayLog).mockReturnValue(log as unknown as PlayLog);
    setReport(report({ weakSegments: [WHOLE, TRANSITION, CLUSTER] }));
    show();
    await waitFor(() => expect(headline()).toBe('7~9마디 · 0:12–0:17놓친 노트 확인'));
    expect(screen.getByRole('button', { name: /^7~9마디 · 0:12\.3–0:17\.3/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '24~27마디 · 0:46–0:54 예시 보기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^0:10–0:15: / })).toBeTruthy();
  });

  it('연주 기록이 없으면 서버 노트로 「내 연주 듣기」가 켜지고 노트 재료 문구가 보인다', async () => {
    setReport(report({ weakSegments: [CLUSTER] }));
    vi.mocked(loadAllReportNotes).mockResolvedValue([N(1, 13340, 'RIDE', 'GOOD'), ...NOTES.slice(1)]);
    show();
    const mine = await screen.findByRole('button', { name: '내 연주 듣기' });
    expect((mine as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('이 기기에는 이 판의 연주 기록이 없어 노트에 맞은 타격만 들려요')).toBeTruthy();
  });

  it('노트가 전부 MISS이고 연주 기록도 없으면 「내 연주 듣기」는 꺼진다', async () => {
    setReport(report({ weakSegments: [CLUSTER] }));
    show();
    const mine = await screen.findByRole('button', { name: '내 연주 듣기' });
    expect((mine as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('이 구간에서 노트에 맞은 타격이 없어 내 연주는 들을 수 없어요')).toBeTruthy();
  });

  it('연습 속도로 친 리포트에만 「시각은 원래 빠르기 기준이에요」가 보인다(D7)', async () => {
    setReport(report({ playbackRate: 0.7, weakSegments: [] }));
    show();
    expect(await screen.findByText('시각은 원래 빠르기 기준이에요')).toBeTruthy();
    cleanup();
    setReport(report({ playbackRate: 1, weakSegments: [] }));
    show();
    await screen.findByRole('button', { name: /^0:10–0:15: / });
    expect(screen.queryByText('시각은 원래 빠르기 기준이에요')).toBeNull();
  });

  it('패드 전환 관찰의 [예시 보기]를 누르면 그 전환이 든 구간으로 바뀌고, 구간 버튼으로 되돌아온다', async () => {
    setReport(report({ weakSegments: [WHOLE, TRANSITION, CLUSTER] }));
    show();
    const open = await screen.findByRole('button', { name: '0:46–0:54 예시 보기' });
    expect(screen.getByText('전환 6번 중 6번 놓침 · 100%')).toBeTruthy();
    fireEvent.click(open);
    expect(headline()).toBe('킥 → 스네어전환 연습');
    expect(screen.getByText('킥에서 스네어로 넘어갈 때 100%를 놓쳐요.')).toBeTruthy();
    expect(open.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /0:12\.3–0:17\.3/ }));
    expect(headline()).toBe('0:12–0:17놓친 노트 확인');
  });

  it('[예시 보기]는 한 번만 눌러도 확대 영역으로 화면을 옮긴다(목적지가 다시 만들어지지 않는다)', async () => {
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    setReport(report({ weakSegments: [TRANSITION, CLUSTER] }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: '0:46–0:54 예시 보기' }));
    expect(headline()).toBe('킥 → 스네어전환 연습');
    expect(scrolled).toHaveLength(1);
    // 선택이 바뀌어 확대 영역이 다시 그려진 뒤에도 목적지가 문서에 남아 있고, 새 확대 영역을 담고 있다
    expect(scrolled[0].id).toBe('rp-focus');
    expect(scrolled[0].isConnected).toBe(true);
    expect(scrolled[0].contains(screen.getByRole('heading', { level: 2, name: /전환 연습/ }))).toBe(true);
    spy.mockRestore();
  });

  it('연주 전체 약점은 「그 밖의 관찰」에 버튼 없이 보인다', async () => {
    setReport(report({ weakSegments: [WHOLE, CLUSTER] }));
    show();
    expect(await screen.findByRole('heading', { name: '그 밖의 관찰' })).toBeTruthy();
    expect(screen.getByText('전반적으로 조금 늦게 쳐요.')).toBeTruthy();
    expect(screen.getByText('연주 전체')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '구간 보기' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '패드 전환 관찰' })).toBeNull();
  });

  it('약점이 없으면 안내가 보이고, 막대를 누르면 그 5초가 확대된다', async () => {
    setReport(report({ counts: { PERFECT: 30, GOOD: 0, MISS: 4 }, weakSegments: [] }));
    show();
    expect(await screen.findByText('뚜렷한 약점이 발견되지 않았어요')).toBeTruthy();
    expect(screen.queryByLabelText('놓친 노트가 모인 구간')).toBeNull();
    // 처음에는 놓침이 가장 많은 칸
    await waitFor(() => expect(headline()).toBe('0:10–0:15노트 확인'));
    fireEvent.click(screen.getByRole('button', { name: /^0:45–0:50: / }));
    expect(headline()).toBe('0:45–0:50노트 확인');
    expect(screen.getByText('노트 4개 중 2개 놓침 · 50%')).toBeTruthy();
  });

  it('놓친 구간과 겹치는 막대를 눌러도 그 막대의 5초가 열리고, 놓친 구간은 구간 버튼으로 연다', async () => {
    setReport(report({ weakSegments: [TRANSITION, CLUSTER] }));
    show();
    // 0:10–0:15 막대는 놓친 구간(0:12.3–0:17.3)과 겹친다
    fireEvent.click(await screen.findByRole('button', { name: /^0:10–0:15: / }));
    expect(headline()).toBe('0:10–0:15노트 확인');
    expect(screen.getByRole('button', { name: /^0:10–0:15: / }).getAttribute('aria-pressed')).toBe('true');
    const marker = screen.getByRole('button', { name: /0:12\.3–0:17\.3/ });
    expect(marker.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(marker);
    expect(headline()).toBe('0:12–0:17놓친 노트 확인');
  });

  it('분석 대기 중이면 안내가 보이고, 분석이 오면 놓친 구간이 나타나 확대된다', async () => {
    setReport(report({ analysisStatus: 'PENDING', weakSegments: null }));
    vi.mocked(refreshReport).mockResolvedValue(report({ weakSegments: [CLUSTER] }));
    show();
    expect(await screen.findByText('AI가 연주를 분석하고 있어요')).toBeTruthy();
    await waitFor(() => expect(headline()).toBe('0:12–0:17놓친 노트 확인'), { timeout: 4000 });
    expect(screen.queryByText('AI가 연주를 분석하고 있어요')).toBeNull();
  });

  it('분석 대기 중에는 머리에 곡 이름 대신 자리 표시가 있고, 총평이 오면 바뀐다', async () => {
    setReport(report({ analysisStatus: 'PENDING', weakSegments: null }));
    vi.mocked(refreshReport).mockResolvedValue(
      report({ coachSummary: { level: 'GOOD', text: '잘 쳤어요. 박자가 안정적이에요.', focusPattern: null, source: 'LLM' } }),
    );
    show();
    expect(await screen.findByRole('heading', { level: 1, name: '코치가 연주를 살펴보고 있어요' })).toBeTruthy();
    expect(screen.queryByText(/연주 리포트/)).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: '잘 쳤어요.' }, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('박자가 안정적이에요.')).toBeTruthy();
    expect(screen.queryByText('코치가 연주를 살펴보고 있어요')).toBeNull();
  });

  it('분석 대기 중에 고른 구간은 분석이 도착해도 바뀌지 않는다', async () => {
    setReport(report({ analysisStatus: 'PENDING', weakSegments: null }));
    vi.mocked(refreshReport).mockResolvedValue(report({ weakSegments: [CLUSTER] }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^0:45–0:50: / }));
    expect(headline()).toBe('0:45–0:50노트 확인');
    // 분석이 도착해 놓친 구간 버튼이 생긴 뒤에도 선택은 그대로다
    expect(await screen.findByRole('button', { name: /0:12\.3–0:17\.3/ }, { timeout: 4000 })).toBeTruthy();
    expect(headline()).toBe('0:45–0:50노트 확인');
  });

  it('전환 약점에 열 구간이 없으면 [예시 보기] 버튼을 두지 않는다', async () => {
    vi.mocked(loadAllReportNotes).mockResolvedValue([]);
    setReport(report({ weakSegments: [{ ...TRANSITION, fromMs: 0, toMs: 0 }] }));
    show();
    // 관찰 목록과 (처음 선택된) 확대 영역 두 곳에 같은 문구가 나온다
    expect((await screen.findAllByText('전환 6번 중 6번 놓침 · 100%')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '패드 전환 관찰' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /예시 보기/ })).toBeNull();
  });

  it('노트 조회만 실패하면 막대 자리에 안내와 [다시 시도], 요약과 패드 표는 그린다', async () => {
    vi.mocked(loadAllReportNotes).mockRejectedValue(new Error('network'));
    setReport(report({ weakSegments: [] }));
    show();
    expect(await screen.findByText('분석을 불러오지 못했습니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
    expect(screen.getByLabelText('연주 요약')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '패드별 기록' })).toBeTruthy();
  });

  it('노트 조회가 실패하면 확대 영역은 불러오는 중이 아니라 실패 안내를 보인다', async () => {
    vi.mocked(loadAllReportNotes).mockRejectedValue(new Error('network'));
    setReport(report({ weakSegments: [CLUSTER] }));
    show();
    expect(await screen.findByText('노트를 불러오지 못해 이 구간을 그릴 수 없어요.')).toBeTruthy();
    expect(screen.queryByText('노트를 불러오는 중…')).toBeNull();
    expect(headline()).toBe('0:12–0:17놓친 노트 확인');
  });
});
