// 플레이 기록 한 행 (설계 COACH-연주-기록-화면-개편, 시안 v7). 라이브러리 목록 행과 같은 골격이다.
// 행은 누르는 곳이 아니고 오른쪽 링크(테두리 상자의 리포트·결과)만 이동한다. 왼쪽 모드 그림은 두지 않는다.
// 아직 서버에 없는 기록은 같은 자리에 저장 상태(저장 중… · 저장 실패 + [다시 시도] · 저장 안 됨)를 보인다.
import { rateLabel } from '@/domain/song/practiceRate';
import { Link } from 'react-router-dom';
import { DeletedSongChip } from '@/components/song/DeletedSongChip';
import { LevelBadge } from '@/components/song/LevelBadge';
import { Button } from '@/components/ui/action/Button';
import { accuracyTier, formatPlayClock, playModeName } from '@/domain/play/playLogView';
import { formatRecordingLength } from '@/domain/play/recordingView';
import type { PlayRowView } from './playLogRows';
import './history.css';

export interface PlayLogRowProps {
  row: PlayRowView;
  /** 저장 실패한 기록의 [다시 시도] */
  onRetry: (playId: string) => void;
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
      <path d="M6 3l5 5-5 5" strokeLinecap="round" />
    </svg>
  );
}

function RowLink({ row, sub }: { row: PlayRowView; sub?: boolean }) {
  if (!row.link) return null;
  const label = row.link.kind === 'REPORT' ? '리포트' : '결과';
  return (
    <Link to={row.link.to} className={sub ? 'history-link is-sub' : 'history-link'} aria-label={`${row.title} ${label} 보기`}>
      {label}
      <Chevron />
    </Link>
  );
}

function Action({ row, onRetry }: PlayLogRowProps) {
  if (row.save === 'SAVING') {
    return (
      <>
        <span className="history-save is-saving" role="status">
          <span className="history-save-spin" aria-hidden="true" />
          저장 중…
        </span>
        <RowLink row={row} sub />
      </>
    );
  }
  if (row.save === 'FAILED') {
    return (
      <>
        <span className="history-save is-failed">저장 실패</span>
        <div className="history-act-pair">
          <Button variant="secondary" size="sm" onClick={() => onRetry(row.playId)}>
            다시 시도
          </Button>
          <RowLink row={row} sub />
        </div>
      </>
    );
  }
  if (row.save === 'UNSAVED') {
    return (
      <>
        <span className="history-save is-unsaved" title="이 브라우저에만 있는 기록이에요">
          저장 안 됨
        </span>
        <RowLink row={row} sub />
      </>
    );
  }
  return row.link ? <RowLink row={row} /> : <span className="history-no-report">리포트 없음</span>;
}

function Accuracy({ row }: { row: PlayRowView }) {
  if (row.accuracy == null) {
    return (
      <div className="history-acc" aria-label="정확도 없음">
        <div className="history-acc-top">
          <span className="history-acc-val">—</span>
        </div>
        <div className="history-bar" />
      </div>
    );
  }
  const value = row.accuracy.toFixed(1);
  const score = row.score == null ? null : row.score.toLocaleString('ko-KR');
  const tier = accuracyTier(row.accuracy).toLowerCase();
  return (
    <div className="history-acc" aria-label={score == null ? `정확도 ${value}%` : `정확도 ${value}%, 점수 ${score}`}>
      <div className="history-acc-top">
        <span className="history-acc-val">
          {value}
          <small>%</small>
        </span>
        {score == null ? null : <span className="history-score">{score}</span>}
      </div>
      <div className="history-bar">
        <i className={`history-bar-fill is-${tier}`} style={{ width: `${Math.min(100, Math.max(0, row.accuracy))}%` }} />
      </div>
    </div>
  );
}

export function PlayLogRow({ row, onRetry }: PlayLogRowProps) {
  return (
    <li className="history-row">
      <div className="history-row-info">
        <div className="history-row-title-line">
          <span className={row.titleMuted ? 'history-row-title is-muted' : 'history-row-title'}>{row.title}</span>
          {row.level ? <LevelBadge level={row.level} size="sm" /> : null}
          {row.chips.includes('ABORTED') ? <span className="history-chip">중단</span> : null}
          {row.chips.includes('DELETED') ? <DeletedSongChip /> : null}
          {row.chips.includes('UNAVAILABLE') ? <span className="song-deleted-chip">이용할 수 없는 곡</span> : null}
        </div>
        <div className="history-row-sub">
          <span>{playModeName(row.mode)}</span>
          <span>{formatPlayClock(row.at)}</span>
          {row.durationMs == null ? null : <span className="history-num">{formatRecordingLength(row.durationMs)}</span>}
          {row.wideGoodMs == null ? null : <span>판정 여유 ±{row.wideGoodMs}ms</span>}
          {row.rate == null ? null : <span>{rateLabel(row.rate)} 속도</span>}
        </div>
      </div>
      <Accuracy row={row} />
      <div className="history-act">
        <Action row={row} onRetry={onRetry} />
      </div>
    </li>
  );
}
