// 「누구보다 빠르게」 플레이 화면 (Figma 1182:38163, 카운트다운 1182:38036). 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 카운트다운·「시작!」·「끝!」은 본문 영역(position: relative)에 겹쳐 그린다.
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import { speedDurationMs, type SpeedSeconds } from '@/features/mini/domain/speedRound';
import { SecondBars } from '@/features/mini/components/speed/SecondBars';

interface Props {
  phase: MiniPhase;
  /** 카운트다운 숫자(3·2·1). 카운트다운 단계가 아니면 null */
  countdown: number | null;
  /** 플레이가 시작된 뒤 「시작!」을 보이는 동안 참 */
  showGo: boolean;
  /** 그 판의 제한 시간(초) */
  seconds: SpeedSeconds;
  remainingMs: number;
  count: number;
  /** 지금 속도(최근 1초의 타수) */
  rate: number;
  perSecond: readonly number[];
  best: number | null;
  onQuit: () => void;
}

export function SpeedStage({ phase, countdown, showGo, seconds, remainingMs, count, rate, perSecond, best, onQuit }: Props) {
  // 같은 자리의 같은 요소에서 값만 바뀌도록 한 번만 그린다(3·2·1 → 시작!)
  const overlay: { value: number | 'go'; backdrop: 'dim' | 'clear' } | null =
    phase === 'countdown' && countdown !== null
      ? { value: countdown, backdrop: 'dim' }
      : phase === 'playing' && showGo
        ? { value: 'go', backdrop: 'clear' }
        : null;
  const closing = phase === 'closing';
  const countClass = ['mini-count-value', phase === 'countdown' ? 'is-hidden' : '', closing || overlay?.value === 'go' ? 'is-dim' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className="mini-page mini-stage">
      <div className="mini-stage-top">
        <h2 className="mini-stage-name">누구보다 빠르게</h2>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <div className="mini-time">
          <div className="mini-time-row">
            <span>남은 시간</span>
            <span className="mini-time-value">
              <span data-testid="mini-speed-remaining">{(Math.max(0, remainingMs) / 1000).toFixed(1)}</span>
              <span className="mini-time-unit">초</span>
            </span>
          </div>
          <div className="mini-time-track" aria-hidden="true">
            <div
              className={`mini-time-fill${phase === 'playing' || closing || phase === 'result' ? ' is-running' : ''}`}
              style={phase === 'playing' || closing ? { transitionDuration: `${speedDurationMs(seconds)}ms` } : undefined}
            />
          </div>
        </div>

        <div className="mini-count">
          <div className={countClass}>
            {/* 값이 key라 바뀔 때마다 짧게 튄다. 초당 여러 번 바뀌므로 aria-live를 걸지 않는다 */}
            <span key={count} className="mini-count-num" data-testid="mini-speed-count">
              {count}
            </span>
            <span className="mini-count-unit">타</span>
          </div>
          <p className="mini-count-hint">{phase === 'countdown' ? `「시작!」이 뜨면 ${seconds}초가 흐릅니다.` : '멈추지 말고 계속 치세요.'}</p>
        </div>

        <div className="mini-panel">
          <div className="mini-panel-item">
            <span className="mini-panel-label">지금 속도</span>
            <span className="mini-panel-value">
              <span data-testid="mini-speed-rate">{rate}</span>
              <span className="mini-panel-unit">타 / 초</span>
            </span>
          </div>
          <div className="mini-panel-bars">
            <SecondBars perSecond={perSecond} variant="compact" />
          </div>
          <div className="mini-panel-item">
            <span className="mini-panel-label">최고 기록</span>
            <span className="mini-panel-value">
              <span>{best ?? '—'}</span>
              {best !== null ? <span className="mini-panel-unit">타</span> : null}
            </span>
          </div>
        </div>

        {overlay ? <Countdown value={overlay.value} backdrop={overlay.backdrop} /> : null}
        {closing ? (
          <div className="mini-end" role="status">
            <span className="mini-end-text">끝!</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
