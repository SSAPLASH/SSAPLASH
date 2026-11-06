// 곡 선택 (설계 2-1, Figma 112:381·481:30675). 제목 행 · 탭(기본 곡 / 라이브러리) · 검색(300ms 디바운스)+곡 난이도 칩 · 표(SongTable) + 선택한 곡 패널(SongDetailPane).
// 목록은 플레이 후보(playableOnly)만 서버에서 받는다 — READY이고 곡 난이도가 있는 곡(설계 CHART-001 곡 난이도 4-1).
// /play·/sheet가 같이 쓴다. 곡만 고르고 연습 단계는 연주 준비에서 고른다(U17) — [준비]·더블클릭·Enter가 onSelect(songId, 기본 채보 id)를 부른다.
// 선택 결과는 페이지가 URL로 옮긴다.
// 기본 곡 탭에는 추천 곡 줄(RecommendRow)이 필터 아래에 붙는다(설계 COACH-004-song-recommend-picker D1·D4).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  defaultChartId,
  isPlayableStatus,
  SONG_LEVEL_LABEL,
  SONG_LEVEL_ORDER,
  type SongDetail,
  type SongLevel,
  type SongScope,
  type SongSummary,
} from '@/domain/songCatalog';
import { bestAccuracyBySong, bestScoreBySong } from '@/domain/bestRecord';
import { presetDisplayName } from '@/domain/preset';
import { loadPlayLogs } from '@/engine/playLog';
import { useBestRecords } from '@/app/useBestRecords';
import { BestRecordsNotice } from '@/components/play/BestRecordsNotice';
import { useSongs } from '@/store/songStore';
import { useAuth } from '@/store/authStore';
import { entryOf, useRecommendations } from '@/store/recommendationStore';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Segmented';
import { SongTable } from '@/components/play/SongTable';
import { SongDetailPane } from '@/components/play/SongDetailPane';
import { RecommendRow } from '@/components/song/RecommendRow';
import './play/song-picker.css';

interface Props {
  onSelect: (songId: number, chartId: number) => void;
  mode: 'play' | 'sheet';
}

const SEARCH_DEBOUNCE_MS = 300;

const COPY: Record<Props['mode'], { title: string; desc: string }> = {
  play: {
    title: '리듬에 맞춰 도전해요',
    desc: '곡을 고르면 연주 준비로 넘어가요. 라이브러리 탭에는 완료된 곡만 고를 수 있어요.',
  },
  sheet: {
    title: '악보로 차근차근 연습해요',
    desc: '곡을 고르면 연주 준비로 넘어가요. 라이브러리 탭에는 완료된 곡만 고를 수 있어요.',
  },
};

const SCOPE_OPTIONS: { value: SongScope; label: string }[] = [
  { value: 'BUILTIN', label: '기본 곡' },
  { value: 'MINE', label: '라이브러리' },
];

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
function isLocked(tab: SongScope, song: SongSummary): boolean {
  return tab === 'MINE' && !isPlayableStatus(song.status);
}


type DetailState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: SongDetail };

export function SongPicker({ onSelect, mode }: Props) {
  const { source, scope, items, status, error, load, selectSong } = useSongs();
  const presets = useSettings((s) => s.presets);
  const activePresetId = useSettings((s) => s.activePresetId);
  const sensorKind = useSettings((s) => s.sensorKind);
  const connected = useLive((l) => l.connected);
  // 추천 줄: API 곡 소스이고 로그인 상태일 때만 마운트 시 한 번 요청한다(D2·D4)
  const authed = useAuth((a) => a.status === 'authenticated');
  const recoKey = `SONG_PICKER:${mode === 'play' ? 'RHYTHM' : 'SHEET'}`;
  const recoEnabled = import.meta.env.VITE_AUTH_REQUIRED !== 'false' && source === 'api' && authed;
  const recoEntry = useRecommendations((r) => entryOf(r.entries, recoKey));
  const loadReco = useRecommendations((r) => r.load);
  const clickReco = useRecommendations((r) => r.click);
  const clearReco = useRecommendations((r) => r.clear);
  // `?scope=MINE`로 열면 내 곡 탭에서 시작한다(곡 작업실 완료 → 플레이 진입)
  const [params] = useSearchParams();
  const [tab, setTab] = useState<SongScope>(params.get('scope') === 'MINE' ? 'MINE' : scope);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LevelFilter>('ALL');
  // undefined: 사용자가 아직 고르지 않았다(이때는 `?song=` 딥링크 곡, 없으면 첫 곡이 선택된다)
  const [manualId, setManualId] = useState<number | undefined>(undefined);
  const [details, setDetails] = useState<Record<number, DetailState>>({});
  const requested = useRef(new Set<number>());
  const queryRef = useRef(query);
  const firstLoad = useRef(true);
  // 내장 개발 소스만 로컬 기록을 사용한다. API 실패를 로컬값으로 대체하지 않는다.
  const localBests = useMemo(() => {
    const logs = source === 'builtin' ? loadPlayLogs() : [];
    return mode === 'play'
      ? { scores: bestScoreBySong(logs, 'RHYTHM'), accuracies: undefined }
      : { scores: undefined, accuracies: bestAccuracyBySong(logs, 'SHEET') };
  }, [mode, source]);

  const recordsReady = status === 'ready' && scope === tab;
  const records = useBestRecords(recordsReady ? items.map((song) => song.id) : [], mode === 'play' ? 'RHYTHM' : 'SHEET', recordsReady, source);
  const bests = source === 'builtin' ? localBests : { scores: records.scoresBySong, accuracies: records.accuraciesBySong };

  useEffect(() => {
    if (recoEnabled && tab === 'BUILTIN') {
      void loadReco(recoKey, { context: 'SONG_PICKER', mode: mode === 'play' ? 'RHYTHM' : 'SHEET', size: 5 });
    }
  }, [recoEnabled, tab, recoKey, mode, loadReco]);
  useEffect(() => () => clearReco(recoKey), [recoKey, clearReco]);

  // 탭·검색어·난이도가 바뀌면 목록을 다시 읽는다. 검색어 변경만 디바운스하고 나머지는 즉시
  useEffect(() => {
    const delay = firstLoad.current || queryRef.current === query ? 0 : SEARCH_DEBOUNCE_MS;
    firstLoad.current = false;
    queryRef.current = query;
    const t = setTimeout(() => void load(tab, query, listFilter(level)), delay);
    return () => clearTimeout(t);
  }, [tab, query, level, load]);

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
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [params]);
  const ready = status === 'ready';
  const deepTarget =
    deepLinkId !== null && tab === 'MINE' && ready && scope === 'MINE'
      ? items.find((s) => s.id === deepLinkId && isPlayableStatus(s.status))
      : undefined;
  const selectable = (id: number | undefined) => {
    const s = id === undefined ? undefined : items.find((x) => x.id === id);
    return s !== undefined && !isLocked(tab, s);
  };
  const selectedId: number | null = !ready
    ? null
    : selectable(manualId)
      ? (manualId as number)
      : (deepTarget?.id ?? items.find((s) => !isLocked(tab, s))?.id ?? null);
  const selectedSong = selectedId === null ? null : (items.find((s) => s.id === selectedId) ?? null);

  // 선택된 곡의 채보 정보를 한 번 읽는다([준비]가 기본 채보를 고르는 데 쓴다)
  useEffect(() => {
    if (selectedId === null || requested.current.has(selectedId)) return;
    fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  const prepare = (id: number) => {
    const d = details[id];
    if (d?.status === 'ready') {
      const chartId = defaultChartId(d.detail);
      if (chartId !== null) onSelect(id, chartId);
      return;
    }
    if (d?.status === 'loading') return;
    // 아직 못 읽었으면 읽고 나서 넘어간다(더블클릭이 상세 조회보다 빠른 경우)
    selectSong(id).then(
      (detail) => {
        const chartId = defaultChartId(detail);
        if (chartId !== null) onSelect(id, chartId);
      },
      () => fetchDetail(id),
    );
  };

  const selDetail = selectedId === null ? undefined : details[selectedId];
  const chartState: 'loading' | 'error' | 'ready' =
    selDetail?.status === 'ready' && defaultChartId(selDetail.detail) !== null
      ? 'ready'
      : selDetail?.status === 'error' || (selDetail?.status === 'ready' && selDetail.detail.charts.length === 0)
        ? 'error'
        : 'loading';
  const presetName = presetDisplayName(presets, activePresetId);
  const copy = COPY[mode];

  return (
    <div className="play-sp">
      <div className="play-sp-head">
        <h2 className="play-sp-title">{copy.title}</h2>
        <p className="play-sp-desc">{copy.desc}</p>
      </div>

      {source === 'api' && <Segmented label="곡 범위" options={SCOPE_OPTIONS} value={tab} onChange={setTab} />}
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

      {recoEnabled && tab === 'BUILTIN' && recoEntry.status === 'ready' && (
        <RecommendRow
          items={recoEntry.cards}
          onPick={(item) => {
            // 기록은 기다리지 않는다(D8)
            void clickReco(item, recoEntry.requestId);
            onSelect(item.song.id, item.chartId);
          }}
        />
      )}

      {status === 'loading' && (
        <div className="play-sp-center">
          <span className="spinner" aria-label="불러오는 중" />
        </div>
      )}

      {status === 'error' && (
        <div className="notice error col" role="alert">
          <span>{error ?? '곡 목록을 불러오지 못했습니다.'}</span>
          <Button variant="secondary" size="sm" onClick={() => void load(tab, query, listFilter(level))}>
            다시 시도
          </Button>
        </div>
      )}

      {ready && items.length === 0 && level !== 'ALL' && <EmptyState title="이 난이도의 곡이 없어요" description="다른 난이도를 골라 보세요." />}

      {ready && items.length === 0 && level === 'ALL' && (
        <EmptyState
          title={tab === 'MINE' ? '아직 만든 곡이 없어요' : '곡이 없어요'}
          description={
            tab === 'MINE' ? (
              <>
                <Link to="/studio">라이브러리</Link>에서 음원을 올려 보세요.
              </>
            ) : (
              query ? '검색어를 바꿔 보세요.' : undefined
            )
          }
        />
      )}

      {ready && items.length > 0 && <BestRecordsNotice status={records.status} retry={records.retry} />}

      {ready && items.length > 0 && (
        <div className="play-sp-grid">
          <div className="play-sp-list">
            <SongTable
              key={`${tab}|${query}|${level}`}
              songs={items}
              selectedId={selectedId}
              onSelect={setManualId}
              onOpen={(id) => {
                setManualId(id);
                prepare(id);
              }}
              mode={mode}
              bestScores={bests.scores}
              bestAccuracies={bests.accuracies}
              isLocked={(s) => isLocked(tab, s)}
            />
            {/* 처리 중·실패 곡은 목록에 오지 않으므로 라이브러리 탭이면 늘 안내한다(설계 4-3) */}
            {tab === 'MINE' && (
              <p className="play-sp-note">
                처리 중·실패한 곡은 <Link to="/studio">라이브러리</Link>에서 확인하세요.
              </p>
            )}
          </div>
          <SongDetailPane
            song={selectedSong}
            mode={mode}
            bestScore={selectedId === null ? undefined : bests.scores?.get(selectedId)}
            bestAccuracy={selectedId === null ? undefined : bests.accuracies?.get(selectedId)}
            presetName={presetName}
            connected={connected}
            keyboardOnly={sensorKind === 'none'}
            chartState={chartState}
            onRetry={() => selectedId !== null && fetchDetail(selectedId)}
            onPrepare={() => selectedId !== null && prepare(selectedId)}
          />
        </div>
      )}
    </div>
  );
}
