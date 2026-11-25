// 「누구보다 빠르게」 플레이 화면 (설계 MODE-006-minigame-speed-ui 3절 「플레이」). 값만 받는다 — 타격 구독·타이머는 페이지가 한다.
// 가운데 고리가 남은 시간이고(제한 시간짜리 CSS 전환 하나), 그 안에 큰 타수와 남은 시간 숫자가 있다. 아래 HUD는 상자 없이 글자만 둔다.
// 타수가 오르면 고리와 숫자가 달아오른다(D11, 메인 색 네온 → 연보라 네온): 단계·칸은 domain/speedRound.speedHeat가 계산하고 색은 speed.css가 정한다.
// 카운트다운·「시작!」·「끝!」은 고리 한가운데(position: relative)에 겹쳐 그린다. 그 글자와 겹치는 타수·남은 시간은 그동안 숨기거나 흐리게 둔다.
// 무대 빛줄기는 카운트다운 동안 꺼져 있다가 플레이가 시작되는 순간 켜진다(자유 연습의 연결 순간과 같은 부품).
import type { CSSProperties } from 'react';
import { StageBeam } from '@/components/drum/StageLights';
import { Button } from '@/components/ui/action/Button';
import { Countdown } from '@/components/ui/feedback/Countdown';
import type { MiniPhase } from '@/features/mini/domain/miniFlow';
import { speedDurationMs, speedHeat, type SpeedSeconds } from '@/features/mini/domain/speedRound';
import { SecondBars } from '@/features/mini/components/speed/SecondBars';
import './speed.css';

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
  /** 그 판의 제한 시간으로 세운 최고 기록 */
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
  const playing = phase === 'playing';
  const closing = phase === 'closing';
  const durationMs = speedDurationMs(seconds);
  const heat = speedHeat(count, seconds);
  // 가운데 큰 글자(3·2·1 → 숨김, 「시작!」·「끝!」 → 흐림)와 겹치는 동안의 표시
  const veil = phase === 'countdown' ? ' is-hidden' : closing || overlay?.value === 'go' ? ' is-dim' : '';
  // 고리 선: 플레이가 시작되면 제한 시간에 걸쳐 줄어들고, 마무리에서는 숨긴다(둥근 끝이 점으로 남지 않게)
  const fillClass = ['mini-speed-ring-fill', playing || closing ? 'is-running' : '', closing ? 'is-empty' : ''].filter(Boolean).join(' ');
  // 지금 흐르는 초의 칸(0부터). 플레이 중에만 강조한다
  const current = playing ? Math.min(seconds - 1, Math.floor(Math.max(0, durationMs - remainingMs) / 1000)) : undefined;

  return (
    <div className="mini-page mini-stage">
      <StageBeam on={phase !== 'countdown'} />
      <div className="mini-stage-top">
        <div className="mini-stage-title">
          <h2 className="mini-stage-name">누구보다 빠르게</h2>
          <span className="mini-stage-sub">{seconds}초 · 스네어</span>
        </div>
        <Button variant="secondary" size="sm" onClick={onQuit}>
          그만하기
        </Button>
      </div>
      <div className="mini-stage-body">
        <div className="mini-speed-center">
          <div className="mini-speed-ring" data-heat={heat.tier} style={{ '--heat-step': heat.step } as CSSProperties}>
            <svg className="mini-speed-ring-svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
              <circle className="mini-speed-ring-track" cx="100" cy="100" r="96" />
              <circle
                className={fillClass}
                cx="100"
                cy="100"
                r="96"
                pathLength={100}
                style={playing || closing ? { transitionDuration: `${durationMs}ms` } : undefined}
              />
            </svg>
            {/* 단계가 바뀌는 순간의 큰 빛. 단계가 key라 단계마다 한 번 재생된다 */}
            {heat.tier > 0 ? <span key={`tier-${heat.tier}`} className="mini-speed-burst" aria-hidden="true" /> : null}
            {/* 울림 링. 타수가 key라 타격마다 다시 재생되고, 칸이 바뀌는 타격(초 수의 배수)은 굵다 */}
            {playing && count > 0 ? (
              <span key={count} className={count % seconds === 0 ? 'mini-speed-pulse is-strong' : 'mini-speed-pulse'} aria-hidden="true" />
            ) : null}
            <div className="mini-count">
              <div className={`mini-count-value${veil}`}>
                {/* 값이 key라 바뀔 때마다 짧게 튄다. 초당 여러 번 바뀌므로 aria-live를 걸지 않는다 */}
                <span key={count} className="mini-count-num" data-testid="mini-speed-count">
                  {count}
                </span>
                <span className="mini-count-unit">타</span>
              </div>
              <div className={`mini-speed-remain${veil}`}>
                <span>남은 시간</span>
                <span className="mini-speed-remain-value" data-testid="mini-speed-remaining">
                  {(Math.max(0, remainingMs) / 1000).toFixed(1)}
                </span>
                <span className="mini-speed-remain-unit">초</span>
              </div>
            </div>
            {/* 3·2·1 → 시작! → 끝! 은 고리 한가운데에 겹친다(같은 자리의 같은 요소에서 값만 바뀐다) */}
            {overlay ? <Countdown value={overlay.value} backdrop={overlay.backdrop} /> : null}
            {closing ? (
              <div className="mini-end" role="status">
                <span className="mini-end-text">끝!</span>
              </div>
            ) : null}
          </div>
          <p className="mini-count-hint">{phase === 'countdown' ? `「시작!」이 뜨면 ${seconds}초가 흐릅니다.` : '멈추지 말고 계속 치세요.'}</p>
        </div>

        <div className="mini-speed-hud">
          <div className="mini-speed-hud-item">
            <span className="mini-speed-hud-cap">지금 속도</span>
            <span className="mini-speed-hud-value">
              <span data-testid="mini-speed-rate">{rate}</span>
              <span className="mini-speed-hud-unit">타 / 초</span>
            </span>
          </div>
          <div className="mini-speed-hud-bars">
            <SecondBars perSecond={perSecond} variant="compact" current={current} />
          </div>
          <div className="mini-speed-hud-item">
            <span className="mini-speed-hud-cap">최고 기록</span>
            <span className="mini-speed-hud-value">
              <span>{best ?? '—'}</span>
              {best !== null ? <span className="mini-speed-hud-unit">타</span> : null}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
