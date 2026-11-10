// 내 곡 목록 보기의 행 하나 (Figma Studio / SongListRow 224:1144, 높이 64). 커버 44 · 제목·보조 줄 · 상태 배지 · 날짜(80) · 동작(220) · ⋯ 메뉴.
// 완료 = [악보 연습] secondary sm + [플레이] primary sm, 실패 = [다시 올리기] secondary sm(보조 줄에 사유), 처리 중 = 단계 글자. ⋯ 메뉴 규칙은 카드와 같다.
// 활성 작업은 ActiveJobCard가 맡으므로 이 행은 활성 작업이 아닌 곡만 그린다.
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyle';
import { SongCover } from '@/components/song/SongCover';
import { artistLabel, chartFailureText, type SongSummary } from '@/domain/songCatalog';
import { dateLabel } from './dateLabel';
import { SongMenu, type SongEditKind, type SongSheetKind } from './SongMenu';
import { AccompanimentBadge } from './AccompanimentBadge';
import { SongStatusBadge } from './SongStatusBadge';
import './studio.css';

interface Props {
  song: SongSummary;
  /** 방금 완료·편집돼 잠깐 강조할 행 */
  justDone: boolean;
  onReupload: (song: SongSummary) => void;
  /** 없으면 ⋯ 메뉴를 그리지 않는다(기능 스위치 꺼짐) */
  onEdit?: (kind: SongEditKind, song: SongSummary) => void;
  /** 있으면 ⋯ 메뉴에 [악보 보기 | 악보 올리기]를 넣는다(악보-곡 연결 스위치 켜짐) */
  onSheet?: (kind: SongSheetKind, song: SongSummary) => void;
  onCoverError?: () => void;
}

export function MySongRow({ song, justDone, onReupload, onEdit, onSheet, onCoverError }: Props) {
  const query = `scope=MINE&song=${song.id}`;
  const ready = song.status === 'READY';
  const failed = song.status === 'FAILED';
  const processing = song.status === 'PROCESSING';
  const sub = failed ? [artistLabel(song.artist), chartFailureText(song.chartFailure)].filter(Boolean).join(' · ') : artistLabel(song.artist);
  const cls = ['studio-row', failed ? 'failed' : '', justDone ? 'just-done' : ''].filter(Boolean).join(' ');

  return (
    <li className={cls}>
      <div className="studio-row-cover">
        <SongCover coverUrl={song.coverUrl} onImageError={onCoverError} />
      </div>
      <span className="studio-row-info">
        <span className="studio-row-title" title={song.title}>
          {song.title}
        </span>
        <span className="studio-row-sub">{sub || ' '}</span>
      </span>
      <SongStatusBadge status={song.status} />
      <AccompanimentBadge songStatus={song.status} accompanimentStatus={song.accompanimentStatus} />
      <span className="studio-row-date">{dateLabel(song.createdAt)}</span>
      <span className="studio-row-actions">
        {ready && (
          <>
            <Link to={`/sheet?${query}`} className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
              악보 연습
            </Link>
            <Link to={`/play?${query}`} className={buttonClassName({ variant: 'primary', size: 'sm' })}>
              플레이
            </Link>
          </>
        )}
        {failed && (
          <Button variant="secondary" size="sm" onClick={() => onReupload(song)}>
            다시 올리기
          </Button>
        )}
        {processing && <span className="studio-row-stage">처리 중</span>}
      </span>
      <span className="studio-row-more">
        {onEdit !== undefined && (
          <SongMenu
            title={song.title}
            status={song.status}
            onPick={(kind) => onEdit(kind, song)}
            sheet={onSheet && { sheetId: song.sheetId, onPick: (kind) => onSheet(kind, song) }}
          />
        )}
      </span>
    </li>
  );
}
