// 연주 기록 화면의 [녹음] 탭 본문 (설계 COACH-연주-기록-화면-개편, 시안 v7). 플레이 기록 탭과 같은 행 목록이다.
// 상태부(RecordingList)는 모드·정렬·검색어와 조회·재생 훅을 갖고, 표시부(RecordingBoard)는 props만 받아 그린다(서버 렌더 테스트 대상).
// 행: 제목(+보조 줄: 모드·곡·녹음 시각) · 재생바 · 타격 수 · ⋯. 제목 변경·삭제 창은 상태부(RecordingList)가 띄운다.
// 재생바(RecordingPlayBar)는 라이브러리 목록 줄의 곡 재생바와 같은 모양으로 모든 행에 항상 보인다. 녹음 길이는 막대 끝의 남은 시간으로 보인다.
// 기본 제목(`곡 제목 · M월 D일 HH:mm`) 그대로인 녹음은 곡 제목·시각이 두 번 나오지 않게 이름만 제목으로 보인다(recordingRowLabel).
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LevelBadge } from '@/components/song/LevelBadge';
import { Button } from '@/components/ui/action/Button';
import { EmptyState } from '@/components/ui/feedback/EmptyState';
import { Input } from '@/components/ui/form/Input';
import { MoreMenu } from '@/components/ui/overlay/MoreMenu';
import { Segmented } from '@/components/ui/form/Segmented';
import { Toast, type ToastVariant } from '@/components/ui/feedback/Toast';
import { ApiError } from '@/api/error';
import { getRecording } from '@/api/play/recordings';
import type { RecordingSort, RecordingSummary } from '@/domain/play/recording';
import { midiFileName, recordingToMidi } from '@/features/history/domain/recordingMidi';
import { downloadBlob } from '@/features/history/media/downloadFile';
import {
  formatHitCount,
  recordingCountLabel,
  recordingModeName,
  recordingRowLabel,
  songDifficulty,
} from '@/domain/play/recordingView';
import { formatPlayDate } from '@/domain/play/playLogView';
import './history.css';
import './recording-list.css';
import { RecordingDeleteDialog } from './RecordingDeleteDialog';
import { RecordingPlayBar, type RecordingPlayPhase } from './RecordingPlayBar';
import { RecordingTitleDialog } from './RecordingTitleDialog';
import { useRecordingList, type RecordingModeFilter } from './useRecordingList';
import { useRecordingPlayback } from './useRecordingPlayback';
import { ErrorState } from '@/components/ui/feedback/ErrorState';

const MODES: { value: RecordingModeFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'FREE', label: '자유 연습' },
  { value: 'RHYTHM', label: '리듬 게임' },
  { value: 'SHEET', label: '악보 연습' },
];

const SORTS: { value: RecordingSort; label: string }[] = [
  { value: 'NEWEST', label: '최신' },
  { value: 'OLDEST', label: '오래된' },
];

const MENU_ITEMS = [
  { key: 'rename', label: '제목 변경' },
  { key: 'delete', label: '삭제', danger: true },
];

/** 타격이 없는 녹음에는 MIDI 항목을 두지 않는다 */
const MENU_ITEMS_WITH_MIDI = [{ key: 'midi', label: 'MIDI로 내보내기' }, ...MENU_ITEMS];

const TOAST_MS = 4000;

interface RowProps {
  item: RecordingSummary;
  /** 재생 대상 행(재생 중이거나 일시정지) */
  playing: boolean;
  paused: boolean;
  loading: boolean;
  positionMs: number;
  onToggle: (item: RecordingSummary) => void;
  onSeek: (ms: number) => void;
  onRename: (item: RecordingSummary) => void;
  onDelete: (item: RecordingSummary) => void;
  onExportMidi: (item: RecordingSummary) => void;
}

// memo: 재생 중에는 위치가 매 프레임 바뀐다. 재생 대상이 아닌 행은 props가 그대로라 다시 그리지 않는다
// (전부 다시 그리면 20행 × 초당 60번이라 화면이 끊긴다). 그래서 콜백은 표시부가 고정된 것을 넘긴다
const RecordingRow = memo(function RecordingRow({ item, playing, paused, loading, positionMs, onToggle, onSeek, onRename, onDelete, onExportMidi }: RowProps) {
  const level = item.song ? songDifficulty(item.song.difficulty) : null;
  // 기본 제목 그대로인 녹음은 곡 제목·녹음 시각이 보조 정보와 겹치지 않게 이름만 보인다
  const label = recordingRowLabel(item);
  const phase: RecordingPlayPhase = playing ? (paused ? 'paused' : 'playing') : loading ? 'loading' : 'idle';
  const pick = (key: string) => {
    if (key === 'rename') onRename(item);
    else if (key === 'delete') onDelete(item);
    else if (key === 'midi') onExportMidi(item);
  };
  return (
    <li className={playing ? 'rec-list-row playing' : 'rec-list-row'}>
      <div className="history-row-info">
        <div className="history-row-title-line">
          <span className="history-row-title">{label.title}</span>
          {label.songInTitle && level ? <LevelBadge level={level} size="sm" /> : null}
          {item.hitCount === 0 ? <span className="history-chip">타격 없음</span> : null}
        </div>
        <div className="history-row-sub">
          {label.showMode ? <span>{recordingModeName(item.mode)}</span> : null}
          {item.song && !label.songInTitle ? (
            <span className="rec-list-song">
              <span className="rec-list-song-title">{item.song.title}</span>
              {level ? <LevelBadge level={level} size="sm" /> : null}
            </span>
          ) : null}
          <span className="history-num">{formatPlayDate(item.startedAt)}</span>
        </div>
      </div>
      <RecordingPlayBar
        title={item.title}
        durationMs={item.durationMs}
        phase={phase}
        positionMs={positionMs}
        onToggle={() => onToggle(item)}
        onSeek={onSeek}
      />
      <span className="rec-list-hits">{formatHitCount(item.hitCount)}</span>
      <div className="rec-list-more-cell">
        <MoreMenu label={`${item.title} 메뉴`} items={item.hitCount > 0 ? MENU_ITEMS_WITH_MIDI : MENU_ITEMS} onPick={pick} />
      </div>
    </li>
  );
});

export interface RecordingBoardProps {
  items: RecordingSummary[];
  total: number;
  hasNext: boolean;
  /** 첫 조회 중 */
  loading: boolean;
  /** [더 보기] 조회 중 */
  loadingMore?: boolean;
  error: string | null;
  mode: RecordingModeFilter;
  sort: RecordingSort;
  q: string;
  /** 재생 대상 행(재생 중이거나 일시정지) */
  playingId: number | null;
  loadingId: number | null;
  /** 재생 대상이 일시정지 상태다 */
  paused?: boolean;
  /** 재생 대상의 위치(ms) */
  positionMs: number;
  onModeChange?: (mode: RecordingModeFilter) => void;
  onSortChange?: (sort: RecordingSort) => void;
  onQueryChange?: (q: string) => void;
  onLoadMore?: () => void;
  onRetry?: () => void;
  onToggle?: (item: RecordingSummary) => void;
  /** 재생바로 위치 옮기기 */
  onSeek?: (ms: number) => void;
  onRename?: (item: RecordingSummary) => void;
  onDelete?: (item: RecordingSummary) => void;
  onExportMidi?: (item: RecordingSummary) => void;
}

/** 표시부. 상태는 모두 props로 받는다 */
export function RecordingBoard({
  items,
  total,
  hasNext,
  loading,
  loadingMore = false,
  error,
  mode,
  sort,
  q,
  playingId,
  loadingId,
  paused = false,
  positionMs,
  onModeChange,
  onSortChange,
  onQueryChange,
  onLoadMore,
  onRetry,
  onToggle,
  onSeek,
  onRename,
  onDelete,
  onExportMidi,
}: RecordingBoardProps) {
  // 행에 넘길 콜백은 한 번만 만들고(행 memo가 깨지지 않게) 부를 때 최신 props를 읽는다
  const latest = useRef({ onToggle, onSeek, onRename, onDelete, onExportMidi });
  useEffect(() => {
    latest.current = { onToggle, onSeek, onRename, onDelete, onExportMidi };
  });
  const rowHandlers = useMemo(
    () => ({
      toggle: (item: RecordingSummary) => latest.current.onToggle?.(item),
      seek: (ms: number) => latest.current.onSeek?.(ms),
      rename: (item: RecordingSummary) => latest.current.onRename?.(item),
      remove: (item: RecordingSummary) => latest.current.onDelete?.(item),
      exportMidi: (item: RecordingSummary) => latest.current.onExportMidi?.(item),
    }),
    [],
  );
  const hasCondition = mode !== 'ALL' || q.trim() !== '';
  const firstLoading = loading && items.length === 0;
  const showCount = !firstLoading && !error;

  let body: ReactNode;
  if (error) {
    body = (
      <ErrorState size="lg" title="녹음 목록 로딩 실패" description={error} action={<Button variant="secondary" onClick={onRetry}>다시 시도</Button>} />
    );
  } else if (firstLoading) {
    body = (
      <p className="history-filter-empty" role="status">
        불러오는 중…
      </p>
    );
  } else if (items.length === 0) {
    body = hasCondition ? (
      <EmptyState size="sm" title="조건에 맞는 녹음이 없어요" />
    ) : (
      <EmptyState title="아직 녹음이 없어요" description="상단 녹음 버튼으로 연주를 남겨 보세요." />
    );
  } else {
    body = (
      <>
        <ul className="history-list rec-list" aria-label="녹음 보관함">
          {items.map((item) => (
            <RecordingRow
              key={item.id}
              item={item}
              playing={item.id === playingId}
              paused={item.id === playingId && paused}
              loading={item.id === loadingId}
              positionMs={item.id === playingId ? positionMs : 0}
              onToggle={rowHandlers.toggle}
              onSeek={rowHandlers.seek}
              onRename={rowHandlers.rename}
              onDelete={rowHandlers.remove}
              onExportMidi={rowHandlers.exportMidi}
            />
          ))}
        </ul>
        {hasNext ? (
          <div className="rec-list-more">
            <Button variant="secondary" size="sm" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? '불러오는 중…' : '더 보기'}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="history-toolbar">
        <Input
          compact
          className="history-search"
          label="제목 검색"
          placeholder="제목 검색"
          type="search"
          value={q}
          onChange={(e) => onQueryChange?.(e.target.value)}
        />
        <Segmented options={MODES} value={mode} onChange={(v) => onModeChange?.(v)} label="모드 필터" />
        <Segmented className="history-toolbar-end" options={SORTS} value={sort} onChange={(v) => onSortChange?.(v)} label="정렬" />
      </div>
      {showCount ? <p className="history-count">{recordingCountLabel(total)}</p> : null}
      {body}
    </>
  );
}

/** 상태부: 필터·정렬·검색어, 목록 조회, 재생, 제목 변경·삭제 창, 토스트 */
export function RecordingList() {
  const [mode, setMode] = useState<RecordingModeFilter>('ALL');
  const [sort, setSort] = useState<RecordingSort>('NEWEST');
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ variant: ToastVariant; text: string } | null>(null);
  const [editing, setEditing] = useState<{ kind: 'rename' | 'delete'; item: RecordingSummary } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (variant: ToastVariant, text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ variant, text });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const list = useRecordingList({ mode, sort, q });
  const { reload } = list;
  // 404: 다른 곳에서 이미 지워진 녹음 — 안내 후 목록을 새로 불러온다
  const onMissing = () => {
    notify('info', '이미 지워진 녹음이에요');
    reload();
  };
  const playback = useRecordingPlayback({
    onMissing,
    onError: (message) => notify('error', message),
  });

  // MIDI 내보내기 (설계 REC-002 4-1): 상세 조회 → 변환 → 내려받기. 내보내는 중인 id는 다시 누르지 못한다
  const exportingRef = useRef(new Map<number, AbortController>());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const exporting = exportingRef.current;
    return () => {
      mountedRef.current = false;
      for (const c of exporting.values()) c.abort();
    };
  }, []);
  const exportMidi = (item: RecordingSummary) => {
    const id = item.id;
    if (exportingRef.current.has(id)) return;
    const controller = new AbortController();
    exportingRef.current.set(id, controller);
    void (async () => {
      try {
        let detail;
        try {
          detail = await getRecording(id, controller.signal);
        } catch (e) {
          if (!mountedRef.current || controller.signal.aborted) return;
          notify(
            'error',
            e instanceof ApiError && e.status > 0 && e.status < 500 ? e.detail : '녹음을 불러오지 못했어요',
          );
          return;
        }
        if (!mountedRef.current) return;
        try {
          const { bytes, usedChartTiming } = recordingToMidi(detail);
          downloadBlob(new Blob([bytes as BlobPart], { type: 'audio/midi' }), midiFileName(detail.title, detail.id));
          // 곡 녹음인데 채보 템포를 못 써서 120 BPM으로 내보낸 경우만 따로 알린다
          const isSongRecording = detail.song !== null || detail.mode === 'RHYTHM' || detail.mode === 'SHEET';
          if (isSongRecording && !usedChartTiming) notify('info', '곡 빠르기 정보가 없어 120 BPM으로 내보냈어요');
          else notify('success', 'MIDI 파일을 내려받았어요');
        } catch {
          notify('error', 'MIDI 파일을 만들지 못했어요');
        }
      } finally {
        exportingRef.current.delete(id);
      }
    })();
  };

  // 재생 중인 행이 목록에서 사라지면(조건 변경·삭제·다시 불러오기) 정지
  const { playingId, stop } = playback;
  useEffect(() => {
    if (playingId !== null && !list.items.some((i) => i.id === playingId)) stop();
  }, [playingId, list.items, stop]);

  return (
    <>
      <RecordingBoard
        items={list.items}
        total={list.total}
        hasNext={list.hasNext}
        loading={list.loading}
        loadingMore={list.loadingMore}
        error={list.error}
        mode={mode}
        sort={sort}
        q={q}
        playingId={playback.playingId}
        loadingId={playback.loadingId}
        paused={playback.paused}
        positionMs={playback.positionMs}
        onModeChange={setMode}
        onSortChange={setSort}
        onQueryChange={setQ}
        onLoadMore={list.loadMore}
        onRetry={list.reload}
        onToggle={playback.toggle}
        onSeek={playback.seek}
        onRename={(item) => setEditing({ kind: 'rename', item })}
        onDelete={(item) => setEditing({ kind: 'delete', item })}
        onExportMidi={exportMidi}
      />
      {editing?.kind === 'rename' && (
        <RecordingTitleDialog
          key={editing.item.id}
          item={editing.item}
          onSaved={list.replaceItem}
          onMissing={onMissing}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'delete' && (
        <RecordingDeleteDialog
          key={editing.item.id}
          item={editing.item}
          onDeleted={(id) => {
            list.removeItem(id);
            notify('info', '녹음을 삭제했어요');
          }}
          onMissing={onMissing}
          onClose={() => setEditing(null)}
        />
      )}
      <Toast variant={toast?.variant ?? 'info'} text={toast?.text ?? null} regionClassName="rec-list-toast-region" />
    </>
  );
}
