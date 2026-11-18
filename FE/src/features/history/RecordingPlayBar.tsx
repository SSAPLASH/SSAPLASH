// 녹음 재생바 (설계 COACH-연주-기록-화면-개편 v1.4). 라이브러리 목록 줄의 곡 재생바(studio/SongPlayBar)와 같은 모양이다:
// 흰 글리프(10초 뒤로 · 재생/일시정지 · 10초 앞으로), 손잡이 없는 3px 막대(끄는 동안 7px), 막대 아래 양끝에 경과·남은 시간.
// 조작부(song/PlaybackTransport)와 막대(song/SeekBar)는 공유 부품을 그대로 쓴다. 기능 폴더끼리는 import하지 않으므로 틀만 여기에 둔다.
// 모든 행에 항상 보인다. 쉬는 상태(이 녹음이 재생 대상이 아님)는 ▶ + 빈 막대 + 녹음 길이이고, ▶를 누르면 이 녹음이 재생 대상이 된다.
// 준비 중(loading: 상세 조회·오디오 준비)은 쉬는 모양을 그대로 둔다 — 보통 수십 ms라 문구·비활성으로 바꾸면 깜빡임만 남는다.
// 오래 걸릴 때만 ▶가 흐려진다(CSS, 1초 뒤). 다시 누르기는 훅이 무시한다.
// 재생기는 모른다. 상태는 props로 받고 조작은 콜백으로만 알린다. 위치 자르기(0~길이)는 재생기가 한다.
import { PlaybackTransport } from '@/components/song/PlaybackTransport';
import { SeekBar } from '@/components/song/SeekBar';
import { formatClock } from '@/domain/time/formatTime';

export type RecordingPlayPhase = 'idle' | 'loading' | 'playing' | 'paused';

interface Props {
  title: string;
  durationMs: number;
  phase: RecordingPlayPhase;
  positionMs: number;
  /** ▶·일시정지. 쉬는 상태면 이 녹음을 재생하고, 재생 대상이면 일시정지 ↔ 이어 재생 */
  onToggle: () => void;
  onSeek: (ms: number) => void;
}

export function RecordingPlayBar({ title, durationMs, phase, positionMs, onToggle, onSeek }: Props) {
  const active = phase === 'playing' || phase === 'paused';
  return (
    <div className={`rec-playbar is-${phase}`} data-phase={phase} aria-busy={phase === 'loading' || undefined}>
      <PlaybackTransport
        className="rec-playbar-controls"
        playing={phase === 'playing'}
        // 쉬는 상태는 10초 버튼 자리만 비워 둔다(재생을 시작해도 ▶ 위치가 움직이지 않게)
        skips={active}
        playLabel={`「${title}」 녹음 재생`}
        pauseLabel={`「${title}」 녹음 일시정지`}
        onToggle={onToggle}
        onSkip={(delta) => onSeek(positionMs + delta)}
      />
      <div className="rec-playbar-progress">
        {active ? (
          <SeekBar layout="ends" label="녹음 위치" positionMs={positionMs} durationMs={durationMs} onSeek={onSeek} />
        ) : (
          <>
            <span className="rec-playbar-track" aria-hidden="true" />
            <span className="free-seek-ends num">
              <span>0:00</span>
              <span>-{formatClock(durationMs)}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
