// 라이브러리 곡 재생바 (설계 CHART-003 라이브러리 재생바 3절). 반주가 준비된 완료 곡에 항상 보인다.
// 쉬는 상태(이 곡이 재생 대상이 아님)는 ▶ + 빈 막대 + 곡 길이이고, ▶를 누르면 이 곡이 재생 대상이 된다.
// 재생 대상이면 불러오는 중·오류·재생/일시정지+진행 막대를 그린다. 재생기는 모른다. 페이지가 만든 SongPlayback(`domain/songPlayback`)의 view를 그리고 조작은 콜백으로만 알린다.
// 진행 막대는 자유 연습의 SeekBar를 쓰고, 모양은 Figma Play / AccompanimentBar state=playing(226:5461)의 재생부(아이콘 버튼 sm · 10px 진행 막대 · 시간)를 따른다.
import { SeekBar } from '@/components/free/SeekBar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { formatClock } from '@/domain/freeAccompaniment';
import type { SongSummary } from '@/domain/songCatalog';
import { isListening, type SongPlayback } from '@/domain/songPlayback';
import { PauseIcon, PlayIcon } from './StudioIcons';
import './studio.css';

interface Props {
  song: SongSummary;
  playback: SongPlayback;
}

export function SongPlayBar({ song, playback }: Props) {
  const { view } = playback;
  const playLabel = `「${song.title}」 반주 재생`;

  if (!isListening(playback, song.id)) {
    return (
      <div className="song-playbar is-idle" data-phase="idle">
        <IconButton size="sm" className="song-playbar-toggle" label={playLabel} onClick={() => playback.onListen(song)}>
          <PlayIcon size={20} />
        </IconButton>
        <div className="free-seek">
          <span className="song-playbar-track" aria-hidden="true" />
          {song.durationMs !== null && song.durationMs > 0 && <span className="free-seek-time num">0:00 / {formatClock(song.durationMs)}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`song-playbar is-${view.phase}`} data-phase={view.phase}>
      {view.phase === 'loading' && <p className="song-playbar-text">반주를 불러오는 중…</p>}
      {view.phase === 'error' && (
        <>
          <p className="song-playbar-text is-error" role="alert" title={view.errorText ?? undefined}>
            {view.errorText}
          </p>
          <Button variant="text" size="sm" onClick={playback.onRetry}>
            다시 시도
          </Button>
        </>
      )}
      {(view.phase === 'playing' || view.phase === 'paused') && (
        <>
          {view.phase === 'playing' ? (
            <IconButton size="sm" className="song-playbar-toggle" label={`「${song.title}」 반주 일시정지`} onClick={playback.onPause}>
              <PauseIcon size={20} />
            </IconButton>
          ) : (
            <IconButton size="sm" className="song-playbar-toggle" label={playLabel} onClick={playback.onResume}>
              <PlayIcon size={20} />
            </IconButton>
          )}
          <SeekBar positionMs={view.positionMs} durationMs={view.durationMs} onSeek={playback.onSeek} />
        </>
      )}
    </div>
  );
}
