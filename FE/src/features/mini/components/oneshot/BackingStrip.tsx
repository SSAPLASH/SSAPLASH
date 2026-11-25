// 노래 막대와 정적 선을 그린 띠. 순수 장식이다(aria-hidden) — 파형이 아니고, 정적의 길이도 그림에서 읽히지 않는다.
// 「지금 위치」 선은 노래가 흐르는 동안만 그린다. 정적에 들어서면 화면에서 움직이는 것이 없어야 한다.
import type { ShotStep } from '@/features/mini/domain/oneShotRound';
import './oneshot.css';

// 막대 높이(%). 장식용 고정 값이다
const BAR_HEIGHTS = [38, 56, 72, 48, 84, 62, 40, 76, 58, 90, 66, 44, 80, 52, 70, 36, 64, 86, 50, 74, 42, 68, 54, 46] as const;

interface Props {
  step: ShotStep;
  /** 「지금 위치」 선의 움직임. 노래가 시작되기까지 남은 시간과 노래가 정적에 닿기까지의 길이(ms). 없으면 선을 그리지 않는다 */
  sweep: { delayMs: number; durationMs: number } | null;
}

export function BackingStrip({ step, sweep }: Props) {
  return (
    <div className="mini-oneshot-strip" aria-hidden="true">
      <div className="mini-oneshot-bars">
        {BAR_HEIGHTS.map((h, i) => (
          <span key={i} className="mini-oneshot-bar" style={{ height: `${h}%` }} />
        ))}
        {step === 'backing' && sweep !== null ? (
          <span
            className="mini-oneshot-now"
            data-testid="mini-oneshot-now"
            style={{ animationDelay: `${Math.max(0, sweep.delayMs)}ms`, animationDuration: `${sweep.durationMs}ms` }}
          />
        ) : null}
      </div>
      <div className="mini-oneshot-rest">
        <span className="mini-oneshot-rest-line" />
        <span className="mini-oneshot-rest-label">정적</span>
      </div>
    </div>
  );
}
