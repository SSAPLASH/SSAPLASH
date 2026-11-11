// 내 곡 카드 보기의 카드 하나 (Figma Studio / SongCard 202:561). 큰 정사각 커버(236) 아래 제목 20·아티스트 14, 배지 행(상태 배지 + MIDI 칩), 동작.
// 카드에는 날짜를 두지 않는다(목록 보기에만). 완료 곡의 리듬 게임은 커버 오른쪽 아래 ▶(hover·focus, 터치 기기는 항상),
// 악보 연습은 카드 아래 [악보 연습](secondary sm). 실패 곡은 사유 한 줄 + [다시 올리기]. ⋯ 메뉴는 onEdit이 있고 완료·실패 곡일 때만 보인다.
// 반주가 준비된 완료 곡은 배지 줄 아래에 재생바가 항상 있고, 소리가 나는 동안 칸보다 긴 제목이 흐른다(설계 CHART-003 라이브러리 재생바).
// 생성 중인 활성 작업은 ActiveJobCard가 맡으므로 이 카드는 활성 작업이 아닌 곡만 그린다(처리 중인데 작업 기록이 없는 곡 포함).
import { Link } from 'react-router-dom';
import { buttonClassName } from '@/components/ui/buttonStyle';
import { Button } from '@/components/ui/Button';
import { MarqueeTitle } from '@/components/song/MarqueeTitle';
import { PlayingEq } from '@/components/song/PlayingEq';
import { SongCover } from '@/components/song/SongCover';
import { canListen, isListening, isSounding, type SongPlayback } from '@/domain/songPlayback';
import { artistLabel, chartFailureText, type SongSummary } from '@/domain/songCatalog';
import { PlayIcon } from './StudioIcons';
import { SongMenu, type SongEditKind, type SongSheetKind } from './SongMenu';
import { AccompanimentBadge } from './AccompanimentBadge';
import { SongStatusBadge } from './SongStatusBadge';
import { SongPlayBar } from './SongPlayBar';
import './studio.css';

interface Props {
  song: SongSummary;
  /** 방금 편집·완료돼 잠깐 강조할 카드 */
  justDone: boolean;
  onReupload: (song: SongSummary) => void;
  /** 없으면 ⋯ 메뉴를 그리지 않는다(기능 스위치 꺼짐) */
  onEdit?: (kind: SongEditKind, song: SongSummary) => void;
  /** 있으면 ⋯ 메뉴에 [악보 보기 | 악보 올리기]를 넣는다(악보-곡 연결 스위치 켜짐) */
  onSheet?: (kind: SongSheetKind, song: SongSummary) => void;
  /** 커버 이미지를 불러오지 못했을 때(서명 URL 만료, U10) */
  onCoverError?: () => void;
  /** 있으면 반주가 준비된 완료 곡에 재생바를 그린다 */
  playback?: SongPlayback;
}

export function MySongCard({ song, justDone, onReupload, onEdit, onSheet, onCoverError, playback }: Props) {
  const listenable = playback !== undefined && canListen(song);
  const query = `scope=MINE&song=${song.id}`;
  const ready = song.status === 'READY';
  const failed = song.status === 'FAILED';
  const showMenu = onEdit !== undefined && (ready || failed);
  const cls = ['studio-card', failed ? 'failed' : '', justDone ? 'just-done' : ''].filter(Boolean).join(' ');

  return (
    <li className={cls}>
      <div className="studio-card-cover">
        <SongCover coverUrl={song.coverUrl} onImageError={onCoverError} />
        {ready && (
          <Link to={`/play?${query}`} className="song-card-play" aria-label={`「${song.title}」 리듬 게임`}>
            <PlayIcon />
          </Link>
        )}
        {showMenu && (
          <SongMenu
            className="studio-card-menu"
            title={song.title}
            status={song.status}
            onPick={(kind) => onEdit(kind, song)}
            sheet={onSheet && { sheetId: song.sheetId, onPick: (kind) => onSheet(kind, song) }}
          />
        )}
      </div>
      <span className="song-title-line">
        <MarqueeTitle className="studio-card-title" text={song.title} active={isSounding(playback, song.id)} />
        {listenable && isListening(playback, song.id) && <PlayingEq playing={isSounding(playback, song.id)} />}
      </span>
      {/* 아티스트가 없어도 줄을 비워 둬 카드끼리 배지 줄 높이를 맞춘다 */}
      <span className="studio-card-artist">{artistLabel(song.artist)}</span>
      <div className="studio-card-badges">
        <SongStatusBadge status={song.status} />
        <AccompanimentBadge songStatus={song.status} accompanimentStatus={song.accompanimentStatus} />
        {song.source === 'MIDI' && <span className="studio-chip">MIDI</span>}
        {song.source === 'MUSICXML' && <span className="studio-chip">MusicXML</span>}
      </div>
      {listenable && <SongPlayBar song={song} playback={playback} />}

      {ready && (
        <div className="studio-card-actions">
          <Link to={`/sheet?${query}`} className={buttonClassName({ variant: 'secondary', size: 'sm', fullWidth: true })}>
            악보 연습
          </Link>
        </div>
      )}

      {failed && (
        <>
          <p className="studio-card-reason">{chartFailureText(song.chartFailure)}</p>
          <div className="studio-card-actions">
            <Button variant="secondary" size="sm" fullWidth onClick={() => onReupload(song)}>
              다시 올리기
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
