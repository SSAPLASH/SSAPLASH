// 곡 선택 (설계 2-1, Figma 112:381). 제목 행 · 탭(기본 곡 / 라이브러리) · 검색(300ms 디바운스) · 표(SongTable) + 선택한 곡 패널(SongDetailPane).
// /play·/sheet가 같이 쓴다. 곡만 고르고 연습 단계는 연주 준비에서 고른다(U17) — [준비]·더블클릭·Enter가 onSelect(songId, 기본 채보 id)를 부른다.
// 선택 결과는 페이지가 URL로 옮긴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isPlayableStatus, sortCharts, type SongDetail, type SongScope, type SongSummary } from '@/domain/songCatalog';
import { bestAccuracyBySong, bestScoreBySong } from '@/domain/bestRecord';
import { loadPlayLogs } from '@/engine/playLog';
import { useSongs } from '@/store/songStore';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Segmented';
import { SongTable } from '@/components/play/SongTable';
import { SongDetailPane } from '@/components/play/SongDetailPane';
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

/** 내 곡 탭에서 완료되지 않은 곡은 고를 수 없다 */
function isLocked(tab: SongScope, song: SongSummary): boolean {
  return tab === 'MINE' && !isPlayableStatus(song.status);
}

/** 기본 연습 단계: NORMAL, 없으면 첫 채보 */
function defaultChartId(detail: SongDetail): number | null {
  const charts = sortCharts(detail.charts);
  return (charts.find((c) => c.difficulty === 'NORMAL') ?? charts[0])?.id ?? null;
}

type DetailState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: SongDetail };

export function SongPicker({ onSelect, mode }: Props) {
  const { source, scope, items, status, error, load, selectSong } = useSongs();
  const presets = useSettings((s) => s.presets);
  const activePresetId = useSettings((s) => s.activePresetId);
  const sensorKind = useSettings((s) => s.sensorKind);
  const connected = useLive((l) => l.connected);
  // `?scope=MINE`로 열면 내 곡 탭에서 시작한다(곡 작업실 완료 → 플레이 진입)
  const [params] = useSearchParams();
  const [tab, setTab] = useState<SongScope>(params.get('scope') === 'MINE' ? 'MINE' : scope);
  const [query, setQuery] = useState('');
  // undefined: 사용자가 아직 고르지 않았다(이때는 `?song=` 딥링크 곡, 없으면 첫 곡이 선택된다)
  const [manualId, setManualId] = useState<number | undefined>(undefined);
  const [details, setDetails] = useState<Record<number, DetailState>>({});
  const requested = useRef(new Set<number>());
  const queryRef = useRef(query);
  const firstLoad = useRef(true);
  // 곡별 최고 기록: 마운트 시점의 로컬 플레이 로그(U18). play는 최고 점수, sheet는 최고 정확도
  const bests = useMemo(() => {
    const logs = loadPlayLogs();
    return mode === 'play'
      ? { scores: bestScoreBySong(logs, 'RHYTHM'), accuracies: undefined }
      : { scores: undefined, accuracies: bestAccuracyBySong(logs, 'SHEET') };
  }, [mode]);

  // 탭·검색어가 바뀌면 목록을 다시 읽는다. 첫 로드는 즉시, 검색어 변경은 디바운스
  useEffect(() => {
    const delay = firstLoad.current || queryRef.current === query ? 0 : SEARCH_DEBOUNCE_MS;
    firstLoad.current = false;
    queryRef.current = query;
    const t = setTimeout(() => void load(tab, query), delay);
    return () => clearTimeout(t);
  }, [tab, query, load]);

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
  const presetName = presets.find((p) => p.id === activePresetId)?.name ?? null;
  const hasUnplayable = tab === 'MINE' && items.some((s) => !isPlayableStatus(s.status));
  const copy = COPY[mode];

  return (
    <div className="play-sp">
      <div className="play-sp-head">
        <h2 className="play-sp-title">{copy.title}</h2>
        <p className="play-sp-desc">{copy.desc}</p>
      </div>

      {source === 'api' && <Segmented label="곡 범위" options={SCOPE_OPTIONS} value={tab} onChange={setTab} />}
      <Input
        className="play-sp-search"
        type="search"
        label="곡 검색"
        value={query}
        placeholder="곡 제목 또는 아티스트 검색"
        onChange={(e) => setQuery(e.target.value)}
      />

      {status === 'loading' && (
        <div className="play-sp-center">
          <span className="spinner" aria-label="불러오는 중" />
        </div>
      )}

      {status === 'error' && (
        <div className="notice error col" role="alert">
          <span>{error ?? '곡 목록을 불러오지 못했습니다.'}</span>
          <Button variant="secondary" size="sm" onClick={() => void load(tab, query)}>
            다시 시도
          </Button>
        </div>
      )}

      {ready && items.length === 0 && (
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

      {ready && items.length > 0 && (
        <div className="play-sp-grid">
          <div className="play-sp-list">
            <SongTable
              key={`${tab}|${query}`}
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
            {hasUnplayable && (
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
