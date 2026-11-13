// Figma Play / AccompanimentBar 226:5485 — 자유 연습 상단 반주 바 (설계 MODE-002-accompaniment-bar-figma 4-1~4-4·4-6).
// 변이 5개(none·loading·playing·paused·error)를 view로 그린다. 글래스 캡슐(데스크톱 64) / ≤640 미니 바(56)는 마크업이 달라 훅으로 가른다.
// 10초 이동은 onSeek(위치 ± SKIP_MS)만 알리고 0 미만·끝 자르기는 훅의 seekTarget이 한다. 재생기는 모른다.
import { PickListIcon } from '@/components/song/PlaybackIcons';
import { PlaybackTransport } from '@/components/song/PlaybackTransport';
import { PlayingEq } from '@/components/song/PlayingEq';
import { MarqueeTitle } from '@/components/song/MarqueeTitle';
import { SongCover } from '@/components/song/SongCover';
import { MOBILE_QUERY, useMediaQuery } from '@/components/shell/useMediaQuery';
import { CloseIcon } from '@/components/song/StudioIcons';
import { Button } from '@/components/ui/action/Button';
import { IconButton } from '@/components/ui/action/IconButton';
import type { AccompanimentBarView } from '@/domain/song/freeAccompaniment';
import { SeekBar } from '@/components/song/SeekBar';
import './free.css';

interface Props {
  view: AccompanimentBarView;
  /** [반주 고르기]·[바꾸기]·[다른 곡]. 없으면 비활성으로 그린다(builtin 빌드) */
  onPick?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onSeek?: (ms: number) => void;
  onOff?: () => void;
  onRetry?: () => void;
}

const NO_PICK_TITLE = '이 빌드에서는 반주를 쓸 수 없어요';

export function AccompanimentBar(props: Props) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  return mobile ? <MiniBar {...props} /> : <DesktopBar {...props} />;
}

/** 조작부 공통: 재생 중이면 일시정지, 아니면 재생. 10초 이동은 현재 위치 기준 */
function transportProps({ view, onPause, onResume, onSeek }: Props) {
  const playing = view.phase === 'playing';
  return {
    playing,
    disabled: view.phase === 'loading',
    playLabel: '반주 재생',
    pauseLabel: '반주 일시정지',
    onToggle: () => (playing ? onPause?.() : onResume?.()),
    onSkip: (delta: number) => onSeek?.(view.positionMs + delta),
  };
}

function DesktopBar(props: Props) {
  const { view, onPick, onOff, onRetry, onSeek } = props;
  const { phase, pick } = view;

  if (phase === 'none' || !pick) {
    return (
      <div className="free-accomp is-none" data-phase="none">
        <SongCover coverUrl={null} className="free-accomp-cover is-dim" />
        <p className="free-accomp-text">반주 없이 연습 중 · 라이브러리의 완료된 곡을 반주로 틀 수 있어요</p>
        <Button variant="secondary" size="sm" className="free-accomp-pick" onClick={onPick} disabled={!onPick} title={onPick ? undefined : NO_PICK_TITLE}>
          반주 고르기
        </Button>
      </div>
    );
  }

  const sub = pick.artist ? `${pick.artist} · 드럼 뺀 반주` : '드럼 뺀 반주';
  const playing = phase === 'playing';

  return (
    <div className={`free-accomp is-${phase}`} data-phase={phase}>
      <SongCover coverUrl={pick.coverUrl} className="free-accomp-cover" />
      <div className="free-accomp-info">
        <div className="free-accomp-title-row">
          <MarqueeTitle text={pick.title} active={playing} className="free-accomp-title" />
          <PlayingEq playing={playing} />
        </div>
        <span className="free-accomp-sub">{sub}</span>
      </div>

      {phase !== 'error' && <PlaybackTransport className="free-accomp-transport" {...transportProps(props)} />}
      {phase === 'loading' && (
        <div className="free-accomp-progress">
          <span className="free-accomp-track" aria-hidden="true">
            <span className="free-accomp-track-soft" />
          </span>
          <p className="free-accomp-loadtext">반주를 불러오는 중…</p>
        </div>
      )}
      {(phase === 'playing' || phase === 'paused') && (
        <div className="free-accomp-progress is-ready">
          <SeekBar layout="ends" positionMs={view.positionMs} durationMs={view.durationMs} onSeek={(ms) => onSeek?.(ms)} />
        </div>
      )}
      {phase === 'error' && (
        <p className="free-accomp-text is-error" role="alert">
          {view.errorText}
        </p>
      )}

      <div className="free-accomp-actions">
        {phase === 'error' ? (
          <>
            <Button variant="text" size="sm" className="free-accomp-text-btn" onClick={onRetry}>
              다시 시도
            </Button>
            <Button variant="text" size="sm" className="free-accomp-text-btn" onClick={onPick} disabled={!onPick}>
              다른 곡
            </Button>
          </>
        ) : (
          <IconButton size="sm" className="free-accomp-quiet" label="반주 바꾸기" onClick={onPick} disabled={!onPick}>
            <PickListIcon />
          </IconButton>
        )}
        <IconButton size="sm" className="free-accomp-quiet" label="반주 끄기" onClick={onOff}>
          <CloseIcon />
        </IconButton>
      </div>
    </div>
  );
}

/** ≤640 미니 바 (Figma 979:4468). 10초 뒤로·[바꾸기]·시간·range 막대는 없다. 제목 칸을 누르면 고르기 시트(U2) */
function MiniBar(props: Props) {
  const { view, onPick, onOff, onRetry } = props;
  const { phase, pick } = view;

  if (phase === 'none' || !pick) {
    return (
      <div className="free-accomp is-mini is-none" data-phase="none">
        <SongCover coverUrl={null} className="free-accomp-cover is-dim" />
        <p className="free-accomp-text">반주 없이 연습 중</p>
        <Button variant="secondary" size="sm" onClick={onPick} disabled={!onPick} title={onPick ? undefined : NO_PICK_TITLE}>
          반주 고르기
        </Button>
      </div>
    );
  }

  const playing = phase === 'playing';
  const pct = view.durationMs > 0 ? Math.min(Math.max(view.positionMs / view.durationMs, 0), 1) * 100 : 0;

  return (
    <div className={`free-accomp is-mini is-${phase}`} data-phase={phase}>
      <button type="button" className="free-accomp-who" aria-label="반주 바꾸기" title="반주 바꾸기" onClick={onPick} disabled={!onPick}>
        <SongCover coverUrl={pick.coverUrl} className="free-accomp-cover" />
        <span className="free-accomp-info">
          <span className="free-accomp-title-row">
            <MarqueeTitle text={pick.title} active={playing} className="free-accomp-title" />
            <PlayingEq playing={playing} />
          </span>
          {phase === 'error' ? (
            <span className="free-accomp-sub is-error" role="alert">
              {view.errorText}
            </span>
          ) : (
            <span className="free-accomp-sub">{phase === 'loading' ? '반주를 불러오는 중…' : '드럼 뺀 반주'}</span>
          )}
        </span>
      </button>

      {phase === 'error' ? (
        <Button variant="text" size="sm" className="free-accomp-text-btn" onClick={onRetry}>
          다시 시도
        </Button>
      ) : (
        <PlaybackTransport className="free-accomp-transport" showBack={false} glyphSize={26} {...transportProps(props)} />
      )}
      <IconButton size="sm" className="free-accomp-quiet" label="반주 끄기" onClick={onOff}>
        <CloseIcon />
      </IconButton>

      {phase === 'loading' && (
        <span className="free-accomp-line free-accomp-track" aria-hidden="true">
          <span className="free-accomp-track-soft" />
        </span>
      )}
      {(phase === 'playing' || phase === 'paused') && (
        <span className="free-accomp-line" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}
