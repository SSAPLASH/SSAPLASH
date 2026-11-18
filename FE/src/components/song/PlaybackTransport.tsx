// 곡 재생 조작부 (설계 MODE-002 D2-1). [10초 뒤로] [재생/일시정지] [10초 앞으로].
// 라이브러리 재생바(SongPlayBar)와 자유 연습 반주 바가 같이 쓴다. 위치 계산·재생기는 모른다 — 누름은 콜백으로만 알린다.
// 모션(누름 0.88배 · 10초 화살표 회전 · 글리프 pop)은 song.css의 .playback-*에만 둔다. 움직임 줄이기면 회전·pop을 끈다.
import { useState } from 'react';
import { IconButton } from '@/components/ui/action/IconButton';
import { SKIP_MS } from '@/domain/song/freeAccompaniment';
import { Back10Icon, Forward10Icon, PauseGlyph, PlayGlyph } from './PlaybackIcons';
import './song.css';

interface Props {
  /** 참이면 일시정지 글리프, 거짓이면 재생 글리프 */
  playing: boolean;
  /** 세 버튼을 모두 비활성으로 그린다(불러오는 중·준비 전) */
  disabled?: boolean;
  /** 거짓이면 10초 버튼 자리를 비워 둔다(쉬는 상태: 재생을 시작해도 ▶ 위치가 움직이지 않게) */
  skips?: boolean;
  /** 거짓이면 10초 뒤로를 그리지 않는다(미니 바) */
  showBack?: boolean;
  /** 재생·일시정지 글리프 크기(기본 30) */
  glyphSize?: number;
  /** 10초 아이콘 크기(기본 24) */
  skipIconSize?: number;
  /** 참이면 10초 버튼만 비활성으로 그린다(쉬는 상태: 재생 버튼은 눌러 시작할 수 있다) */
  skipsDisabled?: boolean;
  playLabel: string;
  pauseLabel: string;
  backLabel?: string;
  forwardLabel?: string;
  onToggle: () => void;
  /** delta = ∓SKIP_MS. 0 미만·끝 자르기는 호출자(훅의 seekTarget)가 한다 */
  onSkip: (deltaMs: number) => void;
  className?: string;
}

type Spin = { dir: 'back' | 'forward'; n: number };

export function PlaybackTransport({
  playing,
  disabled = false,
  skips = true,
  showBack = true,
  glyphSize = 30,
  skipIconSize = 24,
  skipsDisabled = false,
  playLabel,
  pauseLabel,
  backLabel = '10초 뒤로',
  forwardLabel = '10초 앞으로',
  onToggle,
  onSkip,
  className,
}: Props) {
  // 같은 방향을 연속으로 눌러도 회전이 다시 시작되도록 n을 key에 넣는다
  const [spin, setSpin] = useState<Spin | null>(null);
  const skip = (dir: Spin['dir']) => {
    setSpin({ dir, n: (spin?.n ?? 0) + 1 });
    onSkip(dir === 'back' ? -SKIP_MS : SKIP_MS);
  };
  const spinning = (dir: Spin['dir']) => (spin?.dir === dir ? `is-spin-${dir}` : '');
  const cls = ['playback-transport', className].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      {skips ? (
        showBack && (
          <IconButton size="sm" className="playback-skip" label={backLabel} disabled={disabled || skipsDisabled} onClick={() => skip('back')}>
            <span key={spin?.dir === 'back' ? spin.n : 0} className={`playback-icon ${spinning('back')}`}>
              <Back10Icon size={skipIconSize} />
            </span>
          </IconButton>
        )
      ) : (
        showBack && <span className="playback-skip-gap" aria-hidden="true" />
      )}
      <IconButton size="sm" className="playback-toggle" label={playing ? pauseLabel : playLabel} disabled={disabled} onClick={onToggle}>
        {/* key가 바뀌면 다시 마운트되어 글리프가 0.6배에서 1배로 튀어나온다 */}
        <span key={playing ? 'pause' : 'play'} className="playback-glyph">
          {playing ? <PauseGlyph size={glyphSize} /> : <PlayGlyph size={glyphSize} />}
        </span>
      </IconButton>
      {skips ? (
        <IconButton size="sm" className="playback-skip" label={forwardLabel} disabled={disabled || skipsDisabled} onClick={() => skip('forward')}>
          <span key={spin?.dir === 'forward' ? spin.n : 0} className={`playback-icon ${spinning('forward')}`}>
            <Forward10Icon size={skipIconSize} />
          </span>
        </IconButton>
      ) : (
        <span className="playback-skip-gap" aria-hidden="true" />
      )}
    </div>
  );
}
