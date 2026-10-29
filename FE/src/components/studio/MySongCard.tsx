// 내 곡 카드 보기의 카드 하나 (설계 CHART-001 4-1, D4-1·D4-2·D5). 큰 정사각 커버 아래 제목·아티스트, 그 아래 배지·MIDI 칩, 맨 아래 동작.
// 카드에는 날짜를 두지 않는다(목록 보기에만). 완료 곡의 리듬 게임은 커버 오른쪽 아래 ▶(hover·focus, 터치 기기는 항상),
// 악보 연주는 카드 아래 [악보 연주]. 실패 곡은 [다시 올리기] 버튼만 둬 카드 높이를 맞춘다(사유 문장 없음, 배지가 상태를 알린다).
// 활성 작업 카드는 한 줄 전체를 차지하고 진행 띠를 품는다. ⋯ 메뉴는 onEdit이 있고 완료·실패 곡일 때만 보인다.
import { Link } from 'react-router-dom';
import type { ActiveJob, JobProgress } from '@/domain/chartJob';
import { songStatusView, type SongSummary } from '@/domain/songCatalog';
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
  /** 커버 이미지를 불러오지 못했을 때(서명 URL 만료, U10) */
  onCoverError?: () => void;
}

export function MySongCard({ song, job, progress, justDone, onReupload, onEdit, onCoverError }: Props) {
  const view = songStatusView(song.status);
  const query = `scope=MINE&song=${song.id}`;
  const ready = song.status === 'READY';
  const showMenu = onEdit !== undefined && (ready || song.status === 'FAILED');
  const wide = job !== null && progress !== null;
  const cls = ['song-card', wide ? 'wide' : '', song.status === 'FAILED' ? 'failed' : '', justDone ? 'just-done' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={cls}>
      <div className="song-card-cover">
        <SongCover coverUrl={song.coverUrl} onImageError={onCoverError} />
        {ready && (
          <Link to={`/play?${query}`} className="song-card-play" aria-label={`「${song.title}」 리듬 게임`}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 5.5v13l10.5-6.5z" />
            </svg>
          </Link>
        )}
        {showMenu && <SongMenu title={song.title} status={song.status} onPick={(kind) => onEdit(kind, song)} />}
      </div>
      <div className="song-card-body">
        <span className="song-card-title" title={song.title}>
          {song.title}
        </span>
        {/* 아티스트가 없어도 줄을 비워 둬 카드끼리 배지 줄 높이를 맞춘다 */}
        <span className="song-card-artist small dim">{song.artist || ' '}</span>
        <div className="song-card-meta">
          <span className={`my-badge ${view.tone}`}>{view.label}</span>
          {song.source === 'MIDI' && <span className="studio-chip">MIDI</span>}
        </div>

        {ready && (
          <div className="song-card-actions">
            <Link to={`/sheet?${query}`} className="btn-ghost as-button">
              악보 연습
            </Link>
          </div>
        )}

        {song.status === 'FAILED' && (
          <div className="song-card-fail">
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
