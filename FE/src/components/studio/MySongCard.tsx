// 내 곡 카드 보기의 카드 하나 (설계 CHART-001 4-1, D4-1). 큰 정사각 커버 아래 제목·아티스트, 그 아래 배지·MIDI 칩·동작.
// 활성 작업 카드는 한 줄 전체를 차지하고 진행 띠를 품는다. ⋯ 메뉴는 onEdit이 있고 완료·실패 곡일 때만 보인다.
import { Link } from 'react-router-dom';
import type { ActiveJob, JobProgress } from '@/domain/chartJob';
import { songStatusView, type SongSummary } from '@/domain/songCatalog';
import { dateLabel } from './dateLabel';
import { JobStageStrip } from './JobStageStrip';
import { SongCover } from './SongCover';
import { SongMenu, type SongEditKind } from './SongMenu';

interface Props {
  song: SongSummary;
  /** 이 카드가 활성 작업이면 그 작업 */
  job: ActiveJob | null;
  progress: JobProgress | null;
  /** 방금 편집·완료돼 잠깐 강조할 카드 */
  justDone: boolean;
  onReupload: (song: SongSummary) => void;
  /** 없으면 ⋯ 메뉴를 그리지 않는다(기능 스위치 꺼짐) */
  onEdit?: (kind: SongEditKind, song: SongSummary) => void;
}

export function MySongCard({ song, job, progress, justDone, onReupload, onEdit }: Props) {
  const view = songStatusView(song.status);
  const sub = dateLabel(song.createdAt);
  const query = `scope=MINE&song=${song.id}`;
  const showMenu = onEdit !== undefined && (song.status === 'READY' || song.status === 'FAILED');
  const wide = job !== null && progress !== null;
  const cls = ['song-card', wide ? 'wide' : '', song.status === 'FAILED' ? 'failed' : '', justDone ? 'just-done' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={cls}>
      <div className="song-card-cover">
        <SongCover title={song.title} coverUrl={song.coverUrl} />
        {showMenu && <SongMenu title={song.title} onPick={(kind) => onEdit(kind, song)} />}
      </div>
      <div className="song-card-body">
        <span className="song-card-title" title={song.title}>
          {song.title}
        </span>
        <span className="song-card-artist small dim">{song.artist || ' '}</span>
        <div className="song-card-meta">
          <span className={`my-badge ${view.tone}`}>{view.label}</span>
          {song.source === 'MIDI' && <span className="studio-chip">MIDI</span>}
          {sub && <span className="faint small">{sub}</span>}
        </div>

        {song.status === 'READY' && (
          <div className="song-card-actions">
            <Link to={`/sheet?${query}`} className="btn-ghost as-button">
              악보 확인
            </Link>
            <Link to={`/play?${query}`} className="btn-primary">
              플레이
            </Link>
          </div>
        )}

        {song.status === 'FAILED' && (
          <div className="song-card-fail">
            <p className="faint small">채보를 만들지 못했습니다. 음원을 다시 올려 주세요.</p>
            <button type="button" className="btn-ghost" onClick={() => onReupload(song)}>
              다시 올리기
            </button>
          </div>
        )}

        {wide && <JobStageStrip job={job} progress={progress} />}
      </div>
    </li>
  );
}
