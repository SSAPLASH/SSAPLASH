// 내 곡 목록 본문 (Figma 207:2110 카드 · 225:4551 목록 · 225:5042 로딩 · 225:5368 오류). 활성 작업은 맨 위 ActiveJobCard 한 줄,
// 그 아래 카드 그리드(데스크톱 3열·태블릿 2열) 또는 목록 행. 빈 목록(첫 방문)은 페이지가 처리한다.
import { Button } from '@/components/ui/Button';
import type { ActiveJob, JobProgress } from '@/domain/chartJob';
import { sortMineSongs, type SongSummary } from '@/domain/songCatalog';
import { ActiveJobCard } from './ActiveJobCard';
import { MySongCard } from './MySongCard';
import { MySongRow } from './MySongRow';
import type { SongEditKind } from './SongMenu';
import './studio.css';

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
  /** 없으면 ⋯ 메뉴를 그리지 않는다(기능 스위치 꺼짐) */
  onEdit?: (kind: SongEditKind, song: SongSummary) => void;
  /** 커버 이미지를 불러오지 못했을 때(서명 URL 만료, U10) */
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
    accompanimentStatus: 'NONE',
    songLevel: null,
    difficulties: [],
    createdAt: job.startedAt,
    coverUrl: null,
  };
}

export function MySongList({ status, items, error, onRetry, active, progress, justDoneId, onReupload, view = 'card', onEdit, onCoverError }: Props) {
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
      <div className="studio-error" role="alert">
        <h3 className="studio-error-title">라이브러리 목록을 불러오지 못했어요</h3>
        <p className="studio-error-desc" title={error ?? undefined}>
          네트워크 상태를 확인하고 다시 시도해 주세요. 올린 곡은 지워지지 않았어요.
        </p>
        <Button variant="primary" size="md" className="studio-error-btn" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    );
  }

  const merged = active && !items.some((s) => s.id === active.songId) ? [tempSong(active), ...items] : items;
  if (merged.length === 0) return null;
  const sorted = sortMineSongs(merged);
  // 진행 단계를 아는 활성 작업은 ActiveJobCard 한 줄로 맨 위에 두고, 목록에서는 뺀다
  const jobShown = active !== null && progress !== null;
  const rows = jobShown ? sorted.filter((s) => s.id !== active.songId) : sorted;

  return (
    <>
      {jobShown && <ActiveJobCard job={active} progress={progress} />}
      {rows.length > 0 &&
        (view === 'card' ? (
          <ul className="studio-grid">
            {rows.map((song) => (
              <MySongCard
                key={song.id}
                song={song}
                justDone={song.id === justDoneId}
                onReupload={onReupload}
                onEdit={onEdit}
                onCoverError={onCoverError}
              />
            ))}
          </ul>
        ) : (
          <ul className="studio-list">
            {rows.map((song) => (
              <MySongRow
                key={song.id}
                song={song}
                justDone={song.id === justDoneId}
                onReupload={onReupload}
                onEdit={onEdit}
                onCoverError={onCoverError}
              />
            ))}
          </ul>
        ))}
    </>
  );
}
