// 내 곡 섹션 목록 (설계 4-2). 로딩·오류·행 목록을 그린다. 빈 목록(①)은 페이지가 처리한다.
import type { ActiveJob, JobProgress } from '@/domain/chartJob';
import { sortMineSongs, type SongSummary } from '@/domain/songCatalog';
import { MySongCard } from './MySongCard';
import { MySongRow } from './MySongRow';
import type { SongEditKind } from './SongMenu';

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
  /** 카드 보기(기본)/목록 보기 */
  view?: StudioView;
  /** 없으면 카드의 ⋯ 메뉴를 그리지 않는다(기능 스위치 꺼짐) */
  onEdit?: (kind: SongEditKind, song: SongSummary) => void;
  /** 카드 커버 이미지를 불러오지 못했을 때(서명 URL 만료, U10) */
  onCoverError?: () => void;
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
    difficulties: [],
    createdAt: job.startedAt,
    coverUrl: null,
  };
}

export function MySongList({ status, items, error, onRetry, active, progress, justDoneId, onReupload, view = 'card', onEdit, onCoverError }: Props) {
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: 24 }}>
        <span className="spinner" aria-label="불러오는 중" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="notice error col" role="alert">
        <span>{error ?? '라이브러리를 불러오지 못했습니다.'}</span>
        <button type="button" className="btn-ghost" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }

  const merged = active && !items.some((s) => s.id === active.songId) ? [tempSong(active), ...items] : items;
  if (merged.length === 0) return null;
  const sorted = sortMineSongs(merged);
  // 활성 작업 행은 항상 맨 위에 둔다
  const rows = active
    ? [...sorted.filter((s) => s.id === active.songId), ...sorted.filter((s) => s.id !== active.songId)]
    : sorted;

  if (view === 'card') {
    return (
      <ul className="song-grid">
        {rows.map((song) => {
          const isActive = active !== null && song.id === active.songId;
          return (
            <MySongCard
              key={song.id}
              song={song}
              job={isActive ? active : null}
              progress={isActive ? progress : null}
              justDone={song.id === justDoneId}
              onReupload={onReupload}
              onEdit={onEdit}
              onCoverError={onCoverError}
            />
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="studio-list">
      {rows.map((song) => {
        const isActive = active !== null && song.id === active.songId;
        return (
          <MySongRow
            key={song.id}
            song={song}
            job={isActive ? active : null}
            progress={isActive ? progress : null}
            justDone={song.id === justDoneId}
            onReupload={onReupload}
          />
        );
      })}
    </ul>
  );
}
