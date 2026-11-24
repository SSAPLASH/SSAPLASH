// 곡 선택 (설계 2-1, Figma 112:381·481:30675). 제목 행 · 안내 접이 바(안내 줄+구분선, 악보 연습 학습 코스 제외) · [왼쪽 열: 탭 · 검색(300ms 디바운스)+곡 난이도 칩 · 표(SongTable) | 선택한 곡 패널(SongDetailPane)].
// 목록은 플레이 후보(playableOnly)만 서버에서 받는다 — READY이고 곡 난이도가 있는 곡(설계 CHART-001 곡 난이도 4-1).
// /play·/sheet가 같이 쓴다.
// 두 모드가 같은 흐름이다(설계 MODE-001-MODE-003-picker-quick-start, MODE-001-play-quick-start): 선택 곡 카드에서 연습 단계까지 고르고
// [플레이]·더블클릭·Enter가 onStart(songId, 고른 채보 id)를 부른다. 단계는 주소 `?song=&chart=`로 처음 골라 둘 수 있다(추천·다시 하기·세팅 복귀).
// 카드의 기록은 고른 단계 기준이다(/play 최고 점수, /sheet 최고 정확도). 표의 기록 열은 곡 전체 최고다.
// 선택 결과는 페이지가 URL로 옮긴다.
// 칩·검색·탭은 둘러보기다 — 사용자가 고른 곡은 목록에서 빠져도 패널에 남고 [플레이]가 된다(설계 CHART-001 곡 난이도·선택 U5).
// 0곡이면 표 틀(머리글·「총 0곡」)을 두고 본문 자리에 안내를 둔다. 라이브러리 안내는 내 곡 범위 0곡일 때만 보인다.
// 추천(설계 COACH-004-song-picker-ai-tab): 로그인·API 소스면 탭 [AI 추천곡]이 붙는다. 추천 곡(R1)은 진입 때 모드마다 한 번 읽고
// AI 추천곡 탭 목록과 기본 곡 탭의 「✦ AI 추천」 라벨이 같은 결과를 쓴다. 선택한 곡 패널 아래는 그 곡과 비슷한 곡(R2) 한 건이다.
// 범위(설계 MODE-003-악보-연습-하위-메뉴, MODE-006-minigame-speed D2): 두 모드 모두 주소(`?scope=MINE`·`?tab=recommend`·`?tab=lessons`, 없으면 기본 곡)가
// 범위의 단일 기준이다 — 사이드바 하위 메뉴와 화면 위 버튼이 같은 주소 값을 바꾼다. 버튼은 사이드바가 펼쳐져 있어도 항상 그린다(설계 SETUP-학습-코스-중급 4-4).
// 리듬 게임에는 학습 코스가 없어 `?tab=lessons`는 기본 곡으로 본다. 주소 값 없이 들어오면 마지막에 본 범위가 아니라 기본 곡에서 시작한다.
// 리듬 게임은 범위 줄 옆에 「미니게임」 링크를 둔다(사이드바가 접히거나 태블릿 폭이면 하위 메뉴가 안 보여서).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { filterRecommended, pickSimilar, type RecommendCard } from '@/domain/song/recommendation';
import { MINI_PATH } from '@/domain/play/miniGame';
import { SHEET_CATEGORY_LABEL, sheetCategoryOf, sheetCategoryQuery, type SheetCategory } from '@/domain/song/sheetCategory';
import {
  chartFallback,
  defaultChartId,
  sortCharts,
  isPlayableStatus,
  SONG_LEVEL_LABEL,
  SONG_LEVEL_ORDER,
  type SongDetail,
  type SongLevel,
  type SongSummary,
} from '@/domain/song/songCatalog';
import { bestAccuracyByChart, bestAccuracyBySong, bestScoreByChart, bestScoreBySong } from '@/domain/play/bestRecord';
import { presetDisplayName } from '@/domain/kit/preset';
import { loadPlayLogs } from '@/engine/playLog';
import { useBestRecords } from '@/features/play/useBestRecords';
import { BestRecordsNotice } from './BestRecordsNotice';
import { useSongs } from '@/store/songStore';
import { songListQuery } from '@/api/song/songQueries';
import { useApiQuery } from '@/runtime/useApiQuery';
import { AUTH_REQUIRED } from '@/config/auth';
import { useAuth } from '@/store/authStore';
import { entryOf, useRecommendations } from '@/store/recommendationStore';
import { useSettings } from '@/store/settingsStore';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { Chip } from '@/components/ui/layout/Chip';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { Input } from '@/components/ui/form/Input';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { Segmented } from '@/components/ui/form/Segmented';
import { SongTable } from './SongTable';
import { SongDetailPane } from './SongDetailPane';
import { LessonCourse } from '@/features/play/components/picker/lesson/LessonCourse';
import { GuideFold } from '@/features/play/components/picker/guide/GuideFold';
import './song-picker.css';
import { InlineError } from '@/components/ui/feedback/InlineError';

interface Props {
  /** [플레이]·표 더블클릭·Enter. 고른 단계(채보)로 시작 확인 창을 연다 */
  onStart: (songId: number, chartId: number) => void;
  mode: 'play' | 'sheet';
  /** 시작 대기 중(채보·반주를 읽는 동안): 카드의 ▶ 플레이가 스피너. 리듬 게임만 넘긴다 */
  starting?: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;
/** 선택이 이만큼 그대로일 때 비슷한 곡을 읽는다 — 키로 행을 빠르게 넘길 때 요청·노출 기록이 쌓이지 않게(검색 디바운스와 같은 값) */
const SIMILAR_DELAY_MS = 300;
/** AI 추천곡 탭이 받는 추천 곡 수(BE 최대) */
const RECOMMEND_SIZE = 10;
/** 패널은 한 건만 보이지만 선택한 곡이 섞여 와도 남도록 여유 있게 받는다 */
const SIMILAR_SIZE = 3;

// 제목 아래 설명 줄은 두지 않는다(설계 QA-page-header-dock-fold)
const COPY: Record<Props['mode'], { title: string }> = {
  play: { title: '리듬에 맞춰 도전해요' },
  sheet: { title: '악보로 차근차근 연습해요' },
};

/** 곡 선택 범위. 기본 곡·내 곡은 곡 목록 scope, RECOMMEND는 추천 API 결과, LESSONS는 학습 코스(악보 연습만, Jira 331)다 */
type PickerTab = SheetCategory;

/** 범위 버튼. 이름은 사이드바 하위 메뉴와 같다(리듬 게임도 같은 이름) */
const option = (value: PickerTab) => ({ value, label: SHEET_CATEGORY_LABEL[value] });
const SCOPE_OPTIONS = [option('BUILTIN'), option('MINE')];
const AI_OPTION = option('RECOMMEND');
const LESSONS_OPTION = option('LESSONS');

type LevelFilter = SongLevel | 'ALL';

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  ...SONG_LEVEL_ORDER.map((v) => ({ value: v, label: SONG_LEVEL_LABEL[v] })),
];

/** 목록 조건: 곡 선택은 항상 플레이 후보만, 난이도는 「전체」가 아닐 때만 */
function listFilter(level: LevelFilter) {
  return { playableOnly: true, songLevel: level === 'ALL' ? undefined : level };
}

/** 내 곡 탭에서 완료되지 않은 곡은 고를 수 없다(playableOnly 응답에는 없지만 내장 소스·구버전 응답 대비) */
function isLocked(tab: PickerTab, song: SongSummary): boolean {
  return tab === 'MINE' && !isPlayableStatus(song.status);
}

/** 0곡 안내(설계 4-2): 추천 없음 → 난이도로 빈 경우 → 라이브러리 탭 → 기본 곡 탭 순으로 고른다 */
function emptyCopy(tab: PickerTab, level: LevelFilter, query: string, noRecommend: boolean): { title: string; description?: ReactNode } {
  if (noRecommend) return { title: '아직 추천할 곡이 없어요', description: '연주 기록을 모아서 실력에 맞는 곡을 추천해 드릴게요.' };
  if (level !== 'ALL') return { title: '이 난이도의 곡이 없어요', description: '다른 난이도를 골라 보세요.' };
  if (tab === 'MINE') {
    return {
      title: '아직 고를 수 있는 곡이 없어요',
      description: (
        <>
          처리 중·실패한 곡은 <Link to="/studio">라이브러리</Link>에서 확인하세요.
        </>
      ),
    };
  }
  return { title: '곡이 없어요', description: query ? '검색어를 바꿔 보세요.' : undefined };
}

type DetailState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: SongDetail };

export function SongPicker({ onStart, mode, starting }: Props) {
  const source = useSongs((s) => s.source);
  const selectSong = useSongs((s) => s.selectSong);
  const presets = useSettings((s) => s.presets);
  const activePresetId = useSettings((s) => s.activePresetId);
  // 추천: API 곡 소스이고 로그인 상태일 때만 탭과 무관하게 마운트 시 한 번 요청한다(U7)
  const authed = useAuth((a) => a.status === 'authenticated');
  const recoKey = `SONG_PICKER:${mode === 'play' ? 'RHYTHM' : 'SHEET'}`;
  const recoEnabled = AUTH_REQUIRED && source === 'api' && authed;
  const recoEntry = useRecommendations((r) => entryOf(r.entries, recoKey));
  const loadReco = useRecommendations((r) => r.load);
  const loadSimilar = useRecommendations((r) => r.loadSimilar);
  const clickReco = useRecommendations((r) => r.click);
  const clearReco = useRecommendations((r) => r.clear);
  const [params, setParams] = useSearchParams();
  const sheet = mode === 'sheet';
  // 주소가 범위의 기준이다: 사이드바 하위 메뉴·권유 카드·레슨 뒤로 가기·곡 작업실 완료가 주소만 바꿔도 범위가 따라 바뀐다
  const wantedTab: PickerTab = sheetCategoryOf({ tab: params.get('tab'), scope: params.get('scope') });
  // 학습 코스는 악보 연습에서만, 추천과 같은 조건(로그인·API 곡 소스)일 때 보인다(설계 SETUP-입문-코스 3-5)
  const lessonsEnabled = sheet && recoEnabled;
  // 로그인이 풀리면 AI 추천곡·학습 코스 버튼은 사라지므로 기본 곡으로 본다
  const tab: PickerTab = (wantedTab === 'RECOMMEND' && !recoEnabled) || (wantedTab === 'LESSONS' && !lessonsEnabled) ? 'BUILTIN' : wantedTab;
  const tabOptions = [...SCOPE_OPTIONS, ...(recoEnabled ? [AI_OPTION] : []), ...(lessonsEnabled ? [LESSONS_OPTION] : [])];
  // 범위를 주소에 남긴다. 곡·단계 값은 그대로 두고 방문 기록은 쌓지 않는다
  const setTab = (next: PickerTab) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const keep = sheetCategoryQuery(next);
        p.delete('tab');
        p.delete('scope');
        if (keep.tab) p.set('tab', keep.tab);
        if (keep.scope) p.set('scope', keep.scope);
        return p;
      },
      { replace: true },
    );
  };
  const isAi = tab === 'RECOMMEND';
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LevelFilter>('ALL');
  // null: 사용자가 아직 고르지 않았다(이때는 `?song=` 딥링크 곡, 없으면 첫 곡이 선택된다).
  // 곡 객체를 기억해 필터로 목록에서 빠져도 패널에 그대로 보인다(U5)
  const [manual, setManual] = useState<SongSummary | null>(null);
  // AI 추천곡 탭에서 직접 고른 곡 id — 그 곡의 [플레이]는 추천 채보로 가고 클릭을 기록한다. 다른 곡을 고르면 지운다
  const [aiPickedId, setAiPickedId] = useState<number | null>(null);
  // 카드에서 고른 연습 단계. 곡을 바꾸면 그 곡의 처음 단계(주소 chart → 기본)로 돌아간다
  const [pickedChart, setPickedChart] = useState<{ songId: number; chartId: number } | null>(null);
  // 비슷한 곡을 읽을 곡 — 선택이 SIMILAR_DELAY_MS 그대로일 때 정해진다
  const [similarFor, setSimilarFor] = useState<number | null>(null);
  const similarKeys = useRef(new Set<string>());
  const [details, setDetails] = useState<Record<number, DetailState>>({});
  const requested = useRef(new Set<number>());
  const queryRef = useRef(query);
  const firstLoad = useRef(true);
  // 서버로 보낼 검색어. 입력은 디바운스 뒤에 옮기고 탭·난이도 변경은 즉시 반영한다
  const [sentQuery, setSentQuery] = useState(query);
  // 곡 목록은 서버 데이터 캐시로 읽는다(설계 TECH-350). AI 추천곡 탭은 곡 목록을 읽지 않는다(받은 추천을 FE에서 거른다).
  const list = useApiQuery({
    ...songListQuery({ scope: tab === 'MINE' ? 'MINE' : 'BUILTIN', q: sentQuery, ...listFilter(level) }, source),
    // 학습 코스도 곡 목록을 쓰지 않는다
    enabled: tab !== 'RECOMMEND' && tab !== 'LESSONS',
  });
  const items = useMemo(() => list.data ?? [], [list.data]);
  const status = list.status;
  const error = list.error;
  // 내장 개발 소스만 로컬 기록을 사용한다. API 실패를 로컬값으로 대체하지 않는다.
  const localBests = useMemo(() => {
    const logs = source === 'builtin' ? loadPlayLogs() : [];
    return mode === 'play'
      ? { scores: bestScoreBySong(logs, 'RHYTHM'), accuracies: undefined }
      : { scores: undefined, accuracies: bestAccuracyBySong(logs, 'SHEET') };
  }, [mode, source]);

  // AI 추천곡 탭 목록: 받은 R1을 검색·칩으로 FE에서 거른다(순서 유지)
  const aiCards: RecommendCard[] = useMemo(
    () => (recoEntry.status === 'ready' ? filterRecommended(recoEntry.cards, query, level === 'ALL' ? null : level) : []),
    [recoEntry, query, level],
  );
  const recoIds = useMemo(() => new Set(recoEntry.status === 'ready' ? recoEntry.cards.map((c) => c.song.id) : []), [recoEntry]);
  const songs: SongSummary[] = useMemo(() => (isAi ? aiCards.map((c) => c.song) : items), [isAi, aiCards, items]);
  const ready = isAi ? recoEntry.status === 'ready' || recoEntry.status === 'hidden' : status === 'ready';
  const listLoading = isAi ? !ready : status === 'loading';

  const recordsReady = isAi ? ready : status === 'ready' && !list.isPlaceholder;
  // 카드의 단계별 기록: 게임은 최고 점수, 악보는 최고 정확도
  const localChartBests = useMemo(() => {
    if (source !== 'builtin') return new Map<number, number>();
    return mode === 'play' ? bestScoreByChart(loadPlayLogs(), 'RHYTHM') : bestAccuracyByChart(loadPlayLogs(), 'SHEET');
  }, [mode, source]);
  const records = useBestRecords(recordsReady ? songs.map((song) => song.id) : [], mode === 'play' ? 'RHYTHM' : 'SHEET', recordsReady, source);
  const bests = source === 'builtin' ? localBests : { scores: records.scoresBySong, accuracies: records.accuraciesBySong };

  useEffect(() => {
    if (recoEnabled) {
      void loadReco(recoKey, { context: 'SONG_PICKER', mode: mode === 'play' ? 'RHYTHM' : 'SHEET', size: RECOMMEND_SIZE });
    }
  }, [recoEnabled, recoKey, mode, loadReco]);
  useEffect(() => () => clearReco(recoKey), [recoKey, clearReco]);
  useEffect(() => {
    const keys = similarKeys.current;
    return () => keys.forEach((k) => clearReco(k));
  }, [clearReco]);

  // 탭·검색어·난이도가 바뀌면 목록을 다시 읽는다. 검색어 변경만 디바운스하고 나머지는 즉시
  useEffect(() => {
    const delay = firstLoad.current || queryRef.current === query ? 0 : SEARCH_DEBOUNCE_MS;
    firstLoad.current = false;
    queryRef.current = query;
    const t = setTimeout(() => setSentQuery(query), delay);
    return () => clearTimeout(t);
  }, [query]);

  // 다음 진입의 기본 탭을 위해 마지막 목록 탭을 기억한다(기존 동작 유지, 설계 TECH-350 U4)
  useEffect(() => {
    if ((tab === 'BUILTIN' || tab === 'MINE') && useSongs.getState().scope !== tab) useSongs.setState({ scope: tab });
  }, [tab]);

  const fetchDetail = useCallback(
    (id: number) => {
      requested.current.add(id);
      setDetails((d) => ({ ...d, [id]: { status: 'loading' } }));
      selectSong(id).then(
        (detail) => setDetails((d) => ({ ...d, [id]: { status: 'ready', detail } })),
        (e: unknown) =>
          setDetails((d) => ({ ...d, [id]: { status: 'error', message: e instanceof Error ? e.message : '곡 정보를 불러오지 못했습니다.' } })),
      );
    },
    [selectSong],
  );

  // `?song={id}`: 내 곡 탭의 목록에 그 곡이 있고 완료 상태면 선택된 채로 연다
  const deepLinkId = useMemo(() => {
    const n = Number(params.get('song'));
    return Number.isInteger(n) && n !== 0 ? n : null;
  }, [params]);
  const deepChartId = useMemo(() => {
    const n = Number(params.get('chart'));
    return Number.isInteger(n) && n !== 0 ? n : null;
  }, [params]);
  // 기본 곡·라이브러리 탭 모두 주소의 곡을 골라 둔다
  const deepTarget =
    deepLinkId !== null && (tab === 'MINE' || tab === 'BUILTIN') && ready && !list.isPlaceholder
      ? items.find((s) => s.id === deepLinkId && isPlayableStatus(s.status))
      : undefined;
  const pick = (id: number) => {
    const s = songs.find((x) => x.id === id);
    if (!s || isLocked(tab, s)) return;
    setManual(s);
    setAiPickedId(isAi ? id : null);
  };
  const selectedSong: SongSummary | null = !ready
    ? null
    : manual
      ? (songs.find((s) => s.id === manual.id) ?? manual)
      : (deepTarget ?? songs.find((s) => !isLocked(tab, s)) ?? null);
  const selectedId = selectedSong?.id ?? null;
  // 추천 채보로 갈 카드: AI 추천곡 탭에서 고른 곡(아직 고르지 않았으면 그 탭에서 자동 선택된 첫 곡)
  const aiCard =
    selectedId !== null && recoEntry.status === 'ready' && (aiPickedId === selectedId || (manual === null && isAi))
      ? recoEntry.cards.find((c) => c.song.id === selectedId)
      : undefined;

  // 선택된 곡의 채보 정보를 한 번 읽는다([플레이]가 단계를 고르는 데 쓴다)
  useEffect(() => {
    if (selectedId === null || requested.current.has(selectedId)) return;
    fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  // 카드가 보일 단계. 직접 고른 단계 → (처음 한 번) 주소의 단계 → AI 추천 채보 → 기본 단계
  const initialChartId = (detail: SongDetail, id: number, card?: RecommendCard): number | null => {
    const has = (c: number | null | undefined): c is number => c != null && detail.charts.some((x) => x.id === c);
    if (pickedChart?.songId === id && has(pickedChart.chartId)) return pickedChart.chartId;
    if (id === deepLinkId && has(deepChartId)) return deepChartId;
    if (card) return chartFallback(detail, card.chartId) ?? card.chartId;
    return defaultChartId(detail);
  };

  // 고른 단계로 시작 확인 창을 연다. AI 추천곡 탭에서 고른 곡은 추천 채보(상세에 없으면 기본 채보)로 가고 클릭을 기록한다(설계 4-3, U2·U5)
  const start = (id: number) => {
    const card = aiCard?.song.id === id ? aiCard : undefined;
    const go = (detail: SongDetail) => {
      const chartId = initialChartId(detail, id, card);
      if (chartId === null) return;
      // 기록은 기다리지 않는다(D8)
      if (card && recoEntry.status === 'ready') void clickReco(card, recoEntry.requestId);
      onStart(id, chartId);
    };
    const d = details[id];
    if (d?.status === 'ready') {
      go(d.detail);
      return;
    }
    if (d?.status === 'loading') return;
    // 아직 못 읽었으면 읽고 나서 넘어간다(더블클릭이 상세 조회보다 빠른 경우)
    selectSong(id).then(go, () => fetchDetail(id));
  };

  // 비슷한 곡(R2): 선택이 SIMILAR_DELAY_MS 그대로면 그 곡으로 한 번 읽는다. 키는 SONG_PICKER:SIMILAR:{id}로 따로 둔다
  useEffect(() => {
    if (!recoEnabled || selectedId === null) return;
    const t = setTimeout(() => setSimilarFor(selectedId), SIMILAR_DELAY_MS);
    return () => clearTimeout(t);
  }, [recoEnabled, selectedId]);
  const similarKey = recoEnabled && similarFor !== null && similarFor === selectedId ? `SONG_PICKER:SIMILAR:${similarFor}` : null;
  const similarDetail = similarFor === null ? undefined : details[similarFor];
  useEffect(() => {
    if (similarKey === null || similarFor === null) return;
    similarKeys.current.add(similarKey);
    // 기준 단계: 상세를 읽었으면 기본 채보의 단계, 아직이면 BE 기본(NORMAL)
    const base =
      similarDetail?.status === 'ready' ? similarDetail.detail.charts.find((c) => c.id === defaultChartId(similarDetail.detail)) : undefined;
    void loadSimilar(similarKey, { songId: similarFor, difficulty: base?.difficulty, size: SIMILAR_SIZE });
  }, [similarKey, similarFor, similarDetail, loadSimilar]);
  const similarEntry = useRecommendations((r) => (similarKey === null ? undefined : entryOf(r.entries, similarKey)));
  const similarCard = similarEntry?.status === 'ready' && selectedId !== null ? pickSimilar(similarEntry.cards, selectedId) : undefined;
  // [이 곡 보기]: 탭·검색·칩은 그대로 두고 그 곡을 선택한 곡으로 바꾼다. [플레이]는 기본 채보(U5)
  const viewSimilar = () => {
    if (!similarCard || similarEntry?.status !== 'ready') return;
    void clickReco(similarCard, similarEntry.requestId);
    setManual(similarCard.song);
    setAiPickedId(null);
  };

  const selDetail = selectedId === null ? undefined : details[selectedId];
  const chartState: 'loading' | 'error' | 'ready' =
    selDetail?.status === 'ready' && defaultChartId(selDetail.detail) !== null
      ? 'ready'
      : selDetail?.status === 'error' || (selDetail?.status === 'ready' && selDetail.detail.charts.length === 0)
        ? 'error'
        : 'loading';
  const presetName = presetDisplayName(presets, activePresetId);
  const quickCharts = selDetail?.status === 'ready' ? sortCharts(selDetail.detail.charts).map((c) => ({ id: c.id, difficulty: c.difficulty })) : [];
  const quickChartId =
    selDetail?.status === 'ready' && selectedId !== null
      ? initialChartId(selDetail.detail, selectedId, aiCard?.song.id === selectedId ? aiCard : undefined)
      : null;
  // 내장 개발 소스는 로컬 로그, 그 밖은 서버 단계별 최고 기록(고른 단계 기준). 게임은 점수, 악보는 정확도
  const serverChartBests = mode === 'play' ? records.scoresByChart : records.accuraciesByChart;
  const bestByChart: Record<number, number | undefined> = Object.fromEntries(
    quickCharts.map((c) => [c.id, source === 'builtin' ? localChartBests.get(c.id) : serverChartBests.get(c.id)]),
  );
  const copy = COPY[mode];

  const scopeTabs = source === 'api' ? <Segmented label="곡 범위" options={tabOptions} value={tab} onChange={setTab} /> : null;
  // 리듬 게임은 범위 줄 오른쪽 끝에 미니게임 링크를 둔다. 범위 줄이 없는 내장 곡 출처에서도 링크는 보인다
  const tabs = sheet ? (
    scopeTabs
  ) : (
    <div className="play-sp-tabs">
      {scopeTabs}
      <Link to={MINI_PATH} className={buttonClassName({ variant: 'secondary', size: 'sm', className: 'play-sp-mini' })}>
        미니게임
      </Link>
    </div>
  );
  // 안내 접이 바(안내 줄·구분선)는 두 모드 모두 보인다. 악보 연습의 학습 코스는 코스 자체가 안내라 숨긴다(설계 MODE-003 안내 영역 U4)
  const showGuide = mode === 'play' || tab !== 'LESSONS';

  return (
    <div className="play-sp">
      <PageHeader title={copy.title} />

      {showGuide && <GuideFold mode={mode} />}

      {tab === 'LESSONS' ? (
        <>
          {tabs}
          <LessonCourse onOpenBuiltin={() => setTab('BUILTIN')} />
        </>
      ) : (
        // 왼쪽 열(탭·검색·표)과 선택 곡 카드: 카드 윗선 = 탭 윗선(Figma 112:696·112:381)
        <div className="play-sp-grid">
          <div className="play-sp-list">
            {tabs}
            <div className="play-sp-filter">
              <Input
                className="play-sp-search"
                type="search"
                label="곡 검색"
                value={query}
                placeholder="곡 제목 또는 아티스트 검색"
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="play-sp-levels" role="group" aria-label="곡 난이도">
                {LEVEL_OPTIONS.map((o) => (
                  <Chip key={o.value} selected={level === o.value} onClick={() => setLevel(o.value)}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </div>

            {listLoading && (
              <div className="play-sp-center">
                <span className="spinner" aria-label="불러오는 중" />
              </div>
            )}

            {!isAi && status === 'error' && (
              <InlineError size="lg" onRetry={list.refetch}>
                {error ?? '곡 목록을 불러오지 못했습니다.'}
              </InlineError>
            )}

            {ready && songs.length > 0 && <BestRecordsNotice status={records.status} retry={records.retry} />}

            {ready && (
              <SongTable
                key={`${tab}|${query}|${level}`}
                songs={songs}
                selectedId={selectedId}
                revealId={deepTarget?.id ?? null}
                onSelect={pick}
                onOpen={(id) => {
                  pick(id);
                  start(id);
                }}
                mode={mode}
                bestScores={bests.scores}
                bestAccuracies={bests.accuracies}
                isLocked={(s) => isLocked(tab, s)}
                isRecommended={tab === 'BUILTIN' ? (s) => recoIds.has(s.id) : undefined}
                emptyState={<EmptyState {...emptyCopy(tab, level, query, isAi && recoEntry.status === 'hidden')} />}
              />
            )}
          </div>
          {ready && (
            <SongDetailPane
              song={selectedSong}
              presetName={presetName}
              chartState={chartState}
              onRetry={() => selectedId !== null && fetchDetail(selectedId)}
              quickStart={{
                charts: quickCharts,
                selectedChartId: quickChartId,
                onSelectChart: (chartId) => selectedId !== null && setPickedChart({ songId: selectedId, chartId }),
                bestKind: mode === 'play' ? 'score' : 'accuracy',
                bestByChart,
                starting,
                onStart: () => selectedId !== null && start(selectedId),
                // 리듬 게임은 주소로 골라 둔 곡이면 ▶ 플레이에 포커스를 준다. 악보 연습은 시작 확인 창이 포커스를 가져간다
                focusStart: mode === 'play' && deepTarget !== undefined && selectedId === deepTarget.id,
              }}
              similar={similarCard}
              onSimilarPick={viewSimilar}
            />
          )}
        </div>
      )}
    </div>
  );
}
