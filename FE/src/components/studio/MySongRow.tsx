// 내 곡 목록의 행 하나 (설계 4-3). 상태별 배지·보조 줄·액션을 그리고, 활성 작업 행이면 진행 띠를 품는다.
import { Link } from 'react-router-dom';
import type { ActiveJob, JobProgress } from '@/domain/chartJob';
import { songStatusView, type SongSummary } from '@/domain/songCatalog';
import { dateLabel } from './dateLabel';
import { JobStageStrip } from './JobStageStrip';

interface Props {
  song: SongSummary;
  /** 이 행이 활성 작업이면 그 작업 */
  job: ActiveJob | null;
  progress: JobProgress | null;
  /** 방금 완료돼 잠깐 강조할 행 */
  justDone: boolean;
  onReupload: (song: SongSummary) => void;
}

export function MySongRow({ song, job, progress, justDone, onReupload }: Props) {
  const view = songStatusView(song.status);
  const sub = [song.artist, dateLabel(song.createdAt)].filter(Boolean).join(' · ');
  const cls = ['studio-row', job ? 'job' : '', justDone ? 'just-done' : ''].filter(Boolean).join(' ');
  const query = `scope=MINE&song=${song.id}`;

  return (
    <li className={cls}>
      <div className="studio-row-head">
        <span className="studio-row-main">
          <span className="studio-row-title">
            {song.title}
            {song.source === 'MIDI' && <span className="studio-chip">MIDI</span>}
          </span>
          {sub && <span className="faint small">{sub}</span>}
        </span>
        <span className={`my-badge ${view.tone}`}>{view.label}</span>
      </div>

      {song.status === 'READY' && (
        <div className="studio-row-actions">
          <Link to={`/sheet?${query}`} className="btn-ghost as-button">
            악보 연습
          </Link>
          <Link to={`/play?${query}`} className="btn-primary">
            리듬 게임
          </Link>
        </div>
      )}

      {song.status === 'FAILED' && (
        <div className="studio-row-fail">
          <p className="faint small">채보를 만들지 못했습니다. 음원을 다시 올려 주세요.</p>
          <button type="button" className="btn-ghost" onClick={() => onReupload(song)}>
            다시 올리기
          </button>
        </div>
      )}

      {song.status === 'PROCESSING' && job && progress && <JobStageStrip job={job} progress={progress} />}
    </li>
  );
}
