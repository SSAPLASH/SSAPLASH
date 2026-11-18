// 내 곡 카드 보기의 카드 하나 (Figma Studio / SongCard 202:561 layout=play, 설계 CHART-003 라이브러리 카드 개편).
// 위에서 아래로: 큰 정사각 커버(⋯ 메뉴, 반주가 준비된 곡은 마우스를 올리면 커버 아래쪽에 재생 UI) → 제목 줄(전체 폭, 재생 대상이면 이퀄라이저)
// → 정보 줄(왼쪽 아티스트·배지 줄, 오른쪽 완료 곡의 [▶ 플레이]) → 맨 아래 버튼(악보 보기·악보 올리기 / 실패 곡 [다시 올리기]).
// [▶ 플레이]를 누르면 리듬 게임·악보 연습 중 고르는 메뉴가 뜬다. 카드에는 날짜를 두지 않는다(목록 보기에만).
// 마우스 올림·카드 안 포커스·플레이 메뉴가 열린 동안 브랜드 테두리와 네온 번짐이 생긴다. ⋯ 메뉴는 onEdit이 있고 완료·실패 곡일 때만 보인다.
// 소리가 나는 동안 칸보다 긴 제목이 흐른다. 실패 사유는 배지 줄 안 오른쪽에 말줄임 한 줄로 둔다.
// 생성 중인 활성 작업은 ActiveJobCard가 맡으므로 이 카드는 활성 작업이 아닌 곡만 그린다(처리 중인데 작업 기록이 없는 곡 포함).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { Button } from '@/components/ui/action/Button';
import { MarqueeTitle } from '@/components/song/MarqueeTitle';
import { PlayingEq } from '@/components/song/PlayingEq';
import { SongCover } from '@/components/song/SongCover';
import { canListen, isListening, isSounding, type SongPlayback } from '@/features/studio/domain/songPlayback';
import { artistLabel, chartFailureText, type SongSummary } from '@/domain/song/songCatalog';
import { SongMenu, type SongEditKind, type SongSheetKind } from './SongMenu';
import { AccompanimentBadge } from '@/features/studio/components/accompaniment/AccompanimentBadge';
import { SongStatusBadge } from '@/components/song/SongStatusBadge';
import { CoverPlayer } from '@/features/studio/components/accompaniment/CoverPlayer';
import { PlayModeMenu } from './PlayModeMenu';
import '@/features/studio/components/studio.css';

interface Props {
  song: SongSummary;
  /** 방금 편집·완료돼 잠깐 강조할 카드 */
  justDone: boolean;
  onReupload: (song: SongSummary) => void;
  onRetryAccompaniment?: (song: SongSummary) => void;
  retryingAccompaniment?: boolean;
  /** 없으면 ⋯ 메뉴를 그리지 않는다 */
  onEdit?: (kind: SongEditKind, song: SongSummary) => void;
  /** 있으면 ⋯ 메뉴와 맨 아래 버튼에 [악보 보기 | 악보 올리기]를 넣는다. 없으면 맨 아래 버튼은 비활성 [악보 보기] */
  onSheet?: (kind: SongSheetKind, song: SongSummary) => void;
  /** 커버 이미지를 불러오지 못했을 때(서명 URL 만료, U10) */
  onCoverError?: () => void;
  /** 있으면 반주가 준비된 완료 곡의 커버 아래에 재생 UI를 그린다 */
  playback?: SongPlayback;
}

export function MySongCard({ song, justDone, onReupload, onRetryAccompaniment, retryingAccompaniment, onEdit, onSheet, onCoverError, playback }: Props) {
  // 플레이 메뉴는 body 끝(portal)에 그려져 카드의 :hover·:focus-within 밖이므로, 열린 동안은 클래스로 강조를 유지한다
  const [menuOpen, setMenuOpen] = useState(false);
  const listenable = playback !== undefined && canListen(song);
  const ready = song.status === 'READY';
  const failed = song.status === 'FAILED';
  const showMenu = onEdit !== undefined && (ready || failed);
  const cls = ['studio-card', failed ? 'failed' : '', justDone ? 'just-done' : '', menuOpen ? 'is-menu-open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={cls}>
      <div className="studio-card-cover">
        <SongCover coverUrl={song.coverUrl} onImageError={onCoverError} />
        {showMenu && (
          <SongMenu
            className="studio-card-menu"
            title={song.title}
            status={song.status}
            onPick={(kind) => onEdit(kind, song)}
            sheet={onSheet && { sheetId: song.sheetId, onPick: (kind) => onSheet(kind, song) }}
          />
        )}
        {listenable && <CoverPlayer song={song} playback={playback} />}
      </div>
      <span className="song-title-line">
        <MarqueeTitle className="studio-card-title" text={song.title} active={isSounding(playback, song.id)} />
        {listenable && isListening(playback, song.id) && <PlayingEq playing={isSounding(playback, song.id)} />}
      </span>
      <div className="studio-card-info">
        <div className="studio-card-info-main">
          {/* 아티스트가 없어도 줄을 비워 둬 카드끼리 배지 줄 높이를 맞춘다 */}
          <span className="studio-card-artist">{artistLabel(song.artist)}</span>
          <div className="studio-card-badges">
            <SongStatusBadge status={song.status} />
            <AccompanimentBadge songStatus={song.status} accompanimentStatus={song.accompanimentStatus} onRetry={song.source === 'MIDI' && onRetryAccompaniment ? () => onRetryAccompaniment(song) : undefined} retrying={retryingAccompaniment} />
            {song.source === 'MIDI' && <span className="studio-chip">MIDI</span>}
            {song.source === 'MUSICXML' && <span className="studio-chip">MusicXML</span>}
            {failed && <span className="studio-card-reason">{chartFailureText(song.chartFailure)}</span>}
          </div>
        </div>
        {ready && <PlayModeMenu song={song} onOpenChange={setMenuOpen} />}
      </div>

      {ready && (
        <div className="studio-card-actions">
          {onSheet === undefined ? (
            <Button variant="secondary" size="sm" fullWidth disabled title="악보 연결이 꺼져 있어요">
              악보 보기
            </Button>
          ) : song.sheetId != null ? (
            <Link
              to={`/studio/sheets/${song.sheetId}`}
              className={buttonClassName({ variant: 'secondary', size: 'sm', fullWidth: true })}
            >
              악보 보기
            </Link>
          ) : (
            <Button variant="text" size="sm" fullWidth onClick={() => onSheet('sheetUpload', song)}>
              악보 올리기
            </Button>
          )}
        </div>
      )}

      {failed && (
        <div className="studio-card-actions">
          <Button variant="secondary" size="sm" fullWidth onClick={() => onReupload(song)}>
            다시 올리기
          </Button>
        </div>
      )}
    </li>
  );
}
