// 커버 아래 재생 UI (Figma Studio / SongCard layout=play, 설계 CHART-003 4-4). 반주가 준비된 완료 곡의 커버 아래쪽에 겹쳐 그린다.
// 조작부는 song/PlaybackTransport(10초 뒤로 · 재생/일시정지 · 10초 앞으로), 시간 바는 free/SeekBar layout="bare"를 그대로 쓴다.
// 보이기·숨기기는 카드 CSS가 정한다(마우스 올림·카드 안 포커스·메뉴 열림). 이 컴포넌트는 재생 대상이면 `is-pinned`만 단다.
// 재생기는 모른다. 페이지가 만든 SongPlayback(`domain/songPlayback`)의 view를 그리고 조작은 콜백으로만 알린다.
import { SeekBar } from '@/components/song/SeekBar';
import { PlaybackTransport } from '@/components/song/PlaybackTransport';
import type { SongSummary } from '@/domain/song/songCatalog';
import { isListening, type SongPlayback } from '@/features/studio/domain/songPlayback';
import '@/features/studio/components/studio.css';

interface Props {
  song: SongSummary;
  playback: SongPlayback;
}

export function CoverPlayer({ song, playback }: Props) {
  const { view } = playback;
  const listening = isListening(playback, song.id);
  const phase = listening ? view.phase : 'idle';
  const playLabel = `「${song.title}」 반주 재생`;
  const pauseLabel = `「${song.title}」 반주 일시정지`;
  const cls = ['studio-cover-player', listening ? 'is-pinned' : ''].filter(Boolean).join(' ');

  if (phase === 'error') {
    return (
      <div className={cls} data-phase="error">
        <p className="studio-cover-player-error">
          <span role="alert" title={view.errorText ?? undefined}>
            {view.errorText}
          </span>
          <button type="button" className="studio-cover-player-retry" onClick={playback.onRetry}>
            다시 시도
          </button>
        </p>
      </div>
    );
  }

  const ready = phase === 'playing' || phase === 'paused';
  const loading = phase === 'loading';
  const skip = (delta: number) => playback.onSeek(view.positionMs + delta);

  return (
    <div className={cls} data-phase={phase}>
      <PlaybackTransport
        className="studio-cover-player-controls"
        playing={phase === 'playing'}
        disabled={loading}
        skipsDisabled={!ready}
        glyphSize={28}
        skipIconSize={22}
        playLabel={playLabel}
        pauseLabel={pauseLabel}
        onToggle={!listening ? () => playback.onListen(song) : phase === 'playing' ? playback.onPause : playback.onResume}
        onSkip={skip}
      />
      {ready ? (
        <SeekBar layout="bare" positionMs={view.positionMs} durationMs={view.durationMs} onSeek={playback.onSeek} />
      ) : (
        <span className={`studio-cover-player-track${loading ? ' is-loading' : ''}`} aria-hidden="true" />
      )}
    </div>
  );
}
