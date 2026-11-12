// 연주 기록 화면의 [녹음] 탭 본문 (Figma 연주 기록 · 녹음 탭 524:32144, Recording / RecordingRow 523:31333).
// 상태부(RecordingList)는 모드·정렬·검색어와 조회·재생 훅을 갖고, 표시부(RecordingBoard)는 props만 받아 그린다(서버 렌더 테스트 대상).
// 열: 재생 · 제목·곡 · 모드 · 녹음 시각 · 길이 · 타격 · ⋯. 제목 변경·삭제 창은 상태부(RecordingList)가 띄운다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LevelBadge } from '@/components/song/LevelBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { MoreMenu } from '@/components/ui/MoreMenu';
import { Segmented } from '@/components/ui/Segmented';
import { Toast, type ToastVariant } from '@/components/ui/Toast';
import { ApiError } from '@/api/error';
import { getRecording } from '@/api/recordings';
import type { RecordingSort, RecordingSummary } from '@/domain/recording';
import { midiFileName, recordingToMidi } from '@/domain/play/recordingMidi';
import { downloadBlob } from '@/media/downloadFile';
import {
  formatHitCount,
  formatRecordingLength,
  recordingCountLabel,
  recordingModeName,
  songDifficulty,
} from '@/domain/play/recordingView';
import { formatPlayDate } from '@/domain/play/playLogView';
import './history.css';
import '@/components/ui/table.css';
import './recording-list.css';
import { RecordingDeleteDialog } from './RecordingDeleteDialog';
import { RecordingTitleDialog } from './RecordingTitleDialog';
import { useRecordingList, type RecordingModeFilter } from './useRecordingList';
import { useRecordingPlayback } from './useRecordingPlayback';
import { ErrorState } from '@/components/ui/ErrorState';

const MODES: { value: RecordingModeFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'FREE', label: '자유' },
  { value: 'RHYTHM', label: '게임' },
  { value: 'SHEET', label: '악보' },
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

function PlayGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor" stroke="none">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .92.5l8.2-5.2a.6.6 0 0 0 0-1L5.42 2.3a.6.6 0 0 0-.92.5Z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor" stroke="none">
      <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" />
      <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" />
    </svg>
  );
}

interface RowProps {
  item: RecordingSummary;
  playing: boolean;
  loading: boolean;
  progress: number;
  onToggle: (item: RecordingSummary) => void;
  onRename?: (item: RecordingSummary) => void;
  onDelete?: (item: RecordingSummary) => void;
  onExportMidi?: (item: RecordingSummary) => void;
}

function RecordingRow({ item, playing, loading, progress, onToggle, onRename, onDelete, onExportMidi }: RowProps) {
  const level = item.song ? songDifficulty(item.song.difficulty) : null;
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const pick = (key: string) => {
    if (key === 'rename') onRename?.(item);
    else if (key === 'delete') onDelete?.(item);
    else if (key === 'midi') onExportMidi?.(item);
  };
  return (
    <tr className={playing ? 'rec-list-row playing' : 'rec-list-row'}>
      <td>
        <IconButton
          size="sm"
          label={playing ? '정지' : '재생'}
          aria-busy={loading || undefined}
          onClick={() => onToggle(item)}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </IconButton>
      </td>
      <td>
        <div className="rec-list-title-cell">
          <span className="rec-list-title">{item.title}</span>
          {item.song ? (
            <span className="rec-list-song">
              <span className="rec-list-song-title">{item.song.title}</span>
              {level ? <LevelBadge level={level} size="sm" /> : null}
            </span>
          ) : null}
          {playing ? (
            <div
              className="rec-list-progress"
              role="progressbar"
              aria-label="재생 진행"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="rec-list-progress-fill" style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
      </td>
      <td className="rec-list-mode">{recordingModeName(item.mode)}</td>
      <td className="rec-list-num">{formatPlayDate(item.startedAt)}</td>
      <td className="rec-list-num">{formatRecordingLength(item.durationMs)}</td>
      <td className="rec-list-num">{formatHitCount(item.hitCount)}</td>
      <td>
        <div className="rec-list-more-cell">
          <MoreMenu label={`${item.title} 메뉴`} items={item.hitCount > 0 ? MENU_ITEMS_WITH_MIDI : MENU_ITEMS} onPick={pick} />
        </div>
      </td>
    </tr>
  );
}

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
  playingId: number | null;
  loadingId: number | null;
  progress: number;
  onModeChange?: (mode: RecordingModeFilter) => void;
  onSortChange?: (sort: RecordingSort) => void;
  onQueryChange?: (q: string) => void;
  onLoadMore?: () => void;
  onRetry?: () => void;
  onToggle?: (item: RecordingSummary) => void;
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
  progress,
  onModeChange,
  onSortChange,
  onQueryChange,
  onLoadMore,
  onRetry,
  onToggle,
  onRename,
  onDelete,
  onExportMidi,
}: RecordingBoardProps) {
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
        <div className="history-table-wrap rec-list-table-wrap">
          <table className="ui-table history-table rec-list-table" aria-label="녹음 보관함">
            <colgroup>
              <col className="rec-list-col-play" />
              <col />
              <col className="rec-list-col-mode" />
              <col className="rec-list-col-date" />
              <col className="rec-list-col-length" />
              <col className="rec-list-col-hits" />
              <col className="rec-list-col-more" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <span className="history-visually-hidden">재생</span>
                </th>
                <th scope="col" className="rec-list-th-title">
                  제목 · 곡
                </th>
                <th scope="col">모드</th>
                <th scope="col">녹음 시각</th>
                <th scope="col">길이</th>
                <th scope="col">타격</th>
                <th scope="col">
                  <span className="history-visually-hidden">메뉴</span>
                  <div className="rec-list-sort">
                    <Segmented options={SORTS} value={sort} onChange={(v) => onSortChange?.(v)} label="정렬" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <RecordingRow
                  key={item.id}
                  item={item}
                  playing={item.id === playingId}
                  loading={item.id === loadingId}
                  progress={item.id === playingId ? progress : 0}
                  onToggle={(it) => onToggle?.(it)}
                  onRename={onRename}
                  onDelete={onDelete}
                  onExportMidi={onExportMidi}
                />
              ))}
            </tbody>
          </table>
        </div>
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
        <p className="history-count">{showCount ? recordingCountLabel(total) : null}</p>
        <div className="history-tools">
          <Segmented options={MODES} value={mode} onChange={(v) => onModeChange?.(v)} label="모드 필터" />
          <Input
            compact
            className="history-search"
            label="제목 검색"
            placeholder="제목 검색"
            type="search"
            value={q}
            onChange={(e) => onQueryChange?.(e.target.value)}
          />
        </div>
      </div>
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
        progress={playback.progress}
        onModeChange={setMode}
        onSortChange={setSort}
        onQueryChange={setQ}
        onLoadMore={list.loadMore}
        onRetry={list.reload}
        onToggle={playback.toggle}
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
