// 내 곡 목록 본문 (Figma 207:2110 카드 · 225:4551 목록 · 225:5042 로딩 · 225:5368 오류). 활성 작업은 맨 위 ActiveJobCard 한 줄,
// 그 아래 카드 그리드(최대 5열) 또는 목록 행. 곡·악보가 모두 없으면(페이지가 empty로 알림) 빈 안내를 둔다.
import type { ActiveJob, JobProgress } from '@/domain/song/chartJob';
import { mergeLibraryItems, type SheetSummary } from '@/features/studio/domain/sheetMusic';
import { sortMineSongs, type SongSummary } from '@/domain/song/songCatalog';
import type { SongPlayback } from '@/features/studio/domain/songPlayback';
import { ActiveJobCard } from '@/features/studio/components/upload/ActiveJobCard';
import { LibraryEmpty } from '@/features/studio/components/LibraryEmpty';
import { MySongCard } from './MySongCard';
import { MySongRow } from './MySongRow';
import { SheetItemCard } from '@/features/studio/components/sheet/SheetItemCard';
import { SheetItemRow } from '@/features/studio/components/sheet/SheetItemRow';
import type { SheetMenuKind } from '@/features/studio/components/sheet/SheetMenu';
import type { SongEditKind, SongSheetKind } from './SongMenu';
import '@/features/studio/components/studio.css';
import { ErrorState } from '@/components/ui/feedback/ErrorState';

/** 내 곡 보기 모드 */
export type StudioView = 'card' | 'list';

interface Props {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: SongSummary[];
  error: string | null;
  onRetry: () => void;
  active: ActiveJob | null;
  progress: JobProgress | null;
  justDoneId: number | null;
  onReupload: (song: SongSummary) => void;
  onRetryAccompaniment?: (song: SongSummary) => void;
  retryingAccompanimentIds?: ReadonlySet<number>;
  /** 카드 보기(기본)/목록 보기 */
  view?: StudioView;
  /** 없으면 ⋯ 메뉴를 그리지 않는다 */
  onEdit?: (kind: SongEditKind, song: SongSummary) => void;
  /** 커버 이미지를 불러오지 못했을 때(서명 URL 만료, U10) */
  onCoverError?: () => void;
  /** 악보 목록. 없으면 곡만 그린다 */
  sheets?: SheetSummary[];
  /** 악보 썸네일을 불러오지 못했을 때(서명 URL 만료). 악보 목록을 다시 읽는다 */
  onSheetCoverError?: () => void;
  /** 악보 항목 ⋯ 메뉴 선택 */
  onSheetMenu?: (kind: SheetMenuKind, sheet: SheetSummary) => void;
  /** 있으면 악보만 항목에 업로드 버튼(곡 올리기)을 그린다 */
  onUploadSong?: (sheet: SheetSummary) => void;
  /** 있으면 곡 ⋯ 메뉴에 [악보 보기 | 악보 올리기]를 넣는다 */
  onSongSheet?: (kind: SongSheetKind, song: SongSummary) => void;
  /** 곡·악보·진행 작업이 모두 없다(페이지가 판단, 악보를 읽는 중이면 거짓). 참이면 목록 자리에 빈 안내를 둔다 */
  empty?: boolean;
  /** 곡 반주 듣기 상태와 조작. 없으면 듣기 UI를 그리지 않는다 */
  playback?: SongPlayback;
}

/** 202 직후 목록에 아직 없는 활성 작업을 임시 곡으로 만든다 */
function tempSong(job: ActiveJob): SongSummary {
  return {
    id: job.songId,
    title: job.title,
    artist: '',
    source: 'AUDIO',
    status: 'PROCESSING',
    bpm: 0,
    timeSignature: '4/4',
    durationMs: null,
    hasAccompaniment: false,
    accompanimentStatus: 'NONE',
    songLevel: null,
    difficulties: [],
    createdAt: job.startedAt,
    coverUrl: null,
    sheetId: null,
  };
}

export function MySongList({
  status,
  items,
  error,
  onRetry,
  active,
  progress,
  justDoneId,
  onReupload,
  onRetryAccompaniment,
  retryingAccompanimentIds,
  view = 'card',
  onEdit,
  onCoverError,
  sheets,
  onSheetMenu,
  onSheetCoverError,
  onSongSheet,
  onUploadSong,
  empty = false,
  playback,
}: Props) {
  if (status === 'idle' || status === 'loading') {
    // 스켈레톤 카드 6장 (Figma 로딩: 커버·제목·아티스트·동작 자리)
    return (
      <ul className="studio-skeleton-grid" role="status" aria-label="불러오는 중">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="studio-skeleton-card" aria-hidden="true">
            <span className="studio-skeleton-bar cover" />
            <span className="studio-skeleton-bar title" />
            <span className="studio-skeleton-bar artist" />
            <span className="studio-skeleton-bar action" />
          </li>
        ))}
      </ul>
    );
  }
  if (status === 'error') {
    return (
      <ErrorState
        size="lg"
        className="studio-list-error"
        title="라이브러리 목록을 불러오지 못했어요"
        description={<span title={error ?? undefined}>네트워크 상태를 확인하고 다시 시도해 주세요. 올린 곡은 지워지지 않았어요.</span>}
        onRetry={onRetry}
      />
    );
  }

  const merged = active && !items.some((s) => s.id === active.songId) ? [tempSong(active), ...items] : items;
  // 악보 목록만 실패한 줄은 보기 전환 줄(StudioPage의 studio-toolbar)에 있다
  if (merged.length === 0 && (sheets?.length ?? 0) === 0) {
    if (!empty) return null;
    return <LibraryEmpty view={view} sheetsEnabled={sheets !== undefined} />;
  }
  const sorted = sortMineSongs(merged);
  // 진행 단계를 아는 활성 작업은 ActiveJobCard 한 줄로 맨 위에 두고, 목록에서는 뺀다
  const jobShown = active !== null && progress !== null;
  const rows = jobShown ? sorted.filter((s) => s.id !== active.songId) : sorted;
  // 곡과 악보를 한 목록으로 합친다(악보가 없으면 곡 순서 그대로)
  const entries = mergeLibraryItems(rows, sheets ?? []);

  return (
    <>
      {jobShown && <ActiveJobCard job={active} progress={progress} />}
      {entries.length > 0 &&
        (view === 'card' ? (
          <ul className="studio-grid">
            {entries.map((it) =>
              it.type === 'song' ? (
                <MySongCard
                  key={`song-${it.song.id}`}
                  song={it.song}
                  justDone={it.song.id === justDoneId}
                  onReupload={onReupload}
                  onRetryAccompaniment={onRetryAccompaniment}
                  retryingAccompaniment={retryingAccompanimentIds?.has(it.song.id)}
                  onEdit={onEdit}
                  onSheet={onSongSheet}
                  onCoverError={onCoverError}
                  playback={playback}
                />
              ) : (
                <SheetItemCard key={`sheet-${it.sheet.id}`} sheet={it.sheet} onMenu={(k, s) => onSheetMenu?.(k, s)} onCoverError={onSheetCoverError} onUploadSong={onUploadSong} />
              ),
            )}
          </ul>
        ) : (
          <ul className="studio-list">
            {entries.map((it) =>
              it.type === 'song' ? (
                <MySongRow
                  key={`song-${it.song.id}`}
                  song={it.song}
                  justDone={it.song.id === justDoneId}
                  onReupload={onReupload}
                  onRetryAccompaniment={onRetryAccompaniment}
                  retryingAccompaniment={retryingAccompanimentIds?.has(it.song.id)}
                  onEdit={onEdit}
                  onSheet={onSongSheet}
                  onCoverError={onCoverError}
                  playback={playback}
                />
              ) : (
                <SheetItemRow key={`sheet-${it.sheet.id}`} sheet={it.sheet} onMenu={(k, s) => onSheetMenu?.(k, s)} onCoverError={onSheetCoverError} onUploadSong={onUploadSong} />
              ),
            )}
          </ul>
        ))}
    </>
  );
}
