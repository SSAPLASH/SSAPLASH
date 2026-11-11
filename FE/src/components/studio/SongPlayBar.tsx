// 라이브러리 곡 재생바 (설계 CHART-003 라이브러리 재생바 3절). 반주가 준비된 완료 곡에 항상 보인다.
// 모양은 Figma 시안 「자유 연습 · 반주 바 — C · 애플 스타일」(971:50674)의 조작부·진행부를 따른다:
// 흰 글리프(10초 뒤로 · 재생/일시정지 · 10초 앞으로), 손잡이 없는 3px 막대(끄는 동안 7px), 막대 아래 양끝에 경과·남은 시간.
// 캡슐 틀·커버·[바꾸기]·[끄기]는 카드·줄이 이미 갖고 있어 옮기지 않았다.
// 쉬는 상태(이 곡이 재생 대상이 아님)는 ▶ + 빈 막대 + 곡 길이이고, ▶를 누르면 이 곡이 재생 대상이 된다.
// 재생기는 모른다. 페이지가 만든 SongPlayback(`domain/songPlayback`)의 view를 그리고 조작은 콜백으로만 알린다.
import { SeekBar } from '@/components/free/SeekBar';
import { PlaybackTransport } from '@/components/song/PlaybackTransport';
import { formatClock } from '@/domain/freeAccompaniment';
import type { SongSummary } from '@/domain/songCatalog';
import { isListening, type SongPlayback } from '@/domain/songPlayback';
import './studio.css';

interface Props {
  song: SongSummary;
  playback: SongPlayback;
}

export function SongPlayBar({ song, playback }: Props) {
  const { view } = playback;
  const playLabel = `「${song.title}」 반주 재생`;
  const pauseLabel = `「${song.title}」 반주 일시정지`;

  if (!isListening(playback, song.id)) {
    const known = song.durationMs !== null && song.durationMs > 0;
    return (
      <div className="song-playbar is-idle" data-phase="idle">
        <PlaybackTransport
          className="song-playbar-controls"
          playing={false}
          skips={false}
          playLabel={playLabel}
          pauseLabel={pauseLabel}
          onToggle={() => playback.onListen(song)}
          onSkip={() => {}}
        />
        <div className="song-playbar-progress">
          <span className="song-playbar-track" aria-hidden="true" />
          <span className="free-seek-ends num">
            {known && (
              <>
                <span>0:00</span>
                <span>-{formatClock(song.durationMs ?? 0)}</span>
              </>
            )}
          </span>
        </div>
      </div>
    );
  }

  const ready = view.phase === 'playing' || view.phase === 'paused';
  const skip = (delta: number) => playback.onSeek(view.positionMs + delta);

  return (
    <div className={`song-playbar is-${view.phase}`} data-phase={view.phase}>
      <PlaybackTransport
        className="song-playbar-controls"
        playing={view.phase === 'playing'}
        disabled={!ready}
        playLabel={playLabel}
        pauseLabel={pauseLabel}
        onToggle={view.phase === 'playing' ? playback.onPause : playback.onResume}
        onSkip={skip}
      />
      <div className="song-playbar-progress">
        {ready ? (
          <SeekBar layout="ends" positionMs={view.positionMs} durationMs={view.durationMs} onSeek={playback.onSeek} />
        ) : (
          <>
            <span className={`song-playbar-track${view.phase === 'loading' ? ' is-loading' : ''}`} aria-hidden="true" />
            {view.phase === 'loading' && <p className="song-playbar-text">반주를 불러오는 중…</p>}
            {view.phase === 'error' && (
              <p className="song-playbar-text is-error">
                <span role="alert" title={view.errorText ?? undefined}>
                  {view.errorText}
                </span>
                <button type="button" className="song-playbar-retry" onClick={playback.onRetry}>
                  다시 시도
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
