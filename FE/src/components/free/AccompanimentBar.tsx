// Figma Play / AccompanimentBar 226:5485 — 자유 연습 상단 반주 바 (설계 MODE-002 3-9·3-10).
// 변이 5개(none·loading·playing·paused·error)를 view로 그리고 조작은 콜백으로만 알린다. 재생기는 모른다.
import { Button } from '@/components/ui/Button';
import type { AccompanimentBarView } from '@/domain/freeAccompaniment';
import { SeekBar } from './SeekBar';
import './free.css';

interface Props {
  view: AccompanimentBarView;
  /** [반주 고르기]·[바꾸기]·[다른 곡]. 없으면 [반주 고르기]를 비활성으로 그린다(builtin 빌드) */
  onPick?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onSeek?: (ms: number) => void;
  onOff?: () => void;
  onRetry?: () => void;
}

function DiscIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);
const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="4.5" width="4" height="15" rx="1" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" />
  </svg>
);

export function AccompanimentBar({ view, onPick, onPause, onResume, onSeek, onOff, onRetry }: Props) {
  const { phase, pick } = view;

  if (phase === 'none' || !pick) {
    return (
      <div className="free-accomp">
        <span className="free-accomp-label">반주</span>
        <p className="free-accomp-text">반주 없이 연습 중 · 라이브러리의 완료된 곡을 반주로 틀 수 있어요</p>
        <Button variant="secondary" onClick={onPick} disabled={!onPick} title={onPick ? undefined : '이 빌드에서는 반주를 쓸 수 없어요'}>
          반주 고르기
        </Button>
      </div>
    );
  }

  const sub = pick.artist ? `${pick.artist} · 드럼 뺀 반주` : '드럼 뺀 반주';
  const seekBar = (
    <SeekBar positionMs={view.positionMs} durationMs={view.durationMs} onSeek={(ms) => onSeek?.(ms)} />
  );

  return (
    <div className={`free-accomp is-${phase}`} data-phase={phase}>
      <span className="free-accomp-label">반주</span>
      <div className="free-accomp-song">
        {pick.coverUrl ? (
          <img className="free-accomp-cover" src={pick.coverUrl} alt="" />
        ) : (
          <span className="free-accomp-cover is-disc">
            <DiscIcon />
          </span>
        )}
        <div className="free-accomp-names">
          <span className="free-accomp-title">{pick.title}</span>
          <span className="free-accomp-sub">{sub}</span>
        </div>
      </div>

      {phase === 'loading' && <p className="free-accomp-text">반주를 불러오는 중…</p>}
      {phase === 'error' && (
        <p className="free-accomp-text is-error" role="alert">
          {view.errorText}
        </p>
      )}
      {(phase === 'playing' || phase === 'paused') && (
        <div className="free-accomp-transport">
          {phase === 'playing' ? (
            <button type="button" className="free-accomp-icon-btn" aria-label="반주 일시정지" onClick={onPause}>
              <PauseIcon />
            </button>
          ) : (
            <button type="button" className="free-accomp-icon-btn" aria-label="반주 재생" onClick={onResume}>
              <PlayIcon />
            </button>
          )}
          {seekBar}
        </div>
      )}

      <div className="free-accomp-actions">
        {phase === 'error' ? (
          <>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              다시 시도
            </Button>
            <Button variant="secondary" size="sm" onClick={onPick}>
              다른 곡
            </Button>
          </>
        ) : phase === 'loading' ? null : (
          <Button variant="secondary" size="sm" onClick={onPick}>
            바꾸기
          </Button>
        )}
        <Button variant="text" size="sm" onClick={onOff}>
          끄기
        </Button>
      </div>
    </div>
  );
}
