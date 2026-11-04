// 약점 카드 오른쪽 구간 재생 패널(COACH-003 설계 4장). 재생 상태는 props로 받고 예약 계산은 하지 않는다.
import { Button } from '@/components/ui/Button';
import type { WeakSegment } from '@/domain/report';

export interface SegmentPlaybackPanelProps {
  seg: WeakSegment;
  rangeText: string;
  /** 막대 위에 칠할 구간(0~1) */
  position: { from: number; to: number };
  playing: boolean;
  rate: 1 | 0.75;
  loop: boolean;
  disabled: boolean;
  onPlay: () => void;
  onStop: () => void;
  onToggleRate: () => void;
  onToggleLoop: () => void;
}

export function SegmentPlaybackPanel({
  seg,
  rangeText,
  position,
  playing,
  rate,
  loop,
  disabled,
  onPlay,
  onStop,
  onToggleRate,
  onToggleLoop,
}: SegmentPlaybackPanelProps) {
  const whole = seg.scope === 'WHOLE';
  const from = Math.min(1, Math.max(0, position.from)) * 100;
  const to = Math.min(1, Math.max(0, position.to)) * 100;
  return (
    <div className="seg-play">
      <div className="seg-play-head">
        <strong>{whole ? '전체 재생' : '구간 재생'}</strong>
        <span className="small dim">{rangeText}</span>
      </div>
      <div className="seg-play-bar">
        <span className="seg-play-range" style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }} />
      </div>
      <div className="seg-play-controls">
        <Button variant="primary" size="md" disabled={disabled} onClick={playing ? onStop : onPlay}>
          {playing ? '정지' : whole ? '처음부터 재생' : '구간 재생'}
        </Button>
        <Button
          variant="secondary"
          size="md"
          aria-pressed={rate === 0.75}
          className={rate === 0.75 ? 'active' : undefined}
          onClick={onToggleRate}
        >
          느리게 0.75×
        </Button>
        <Button variant="secondary" size="md" aria-pressed={loop} className={loop ? 'active' : undefined} onClick={onToggleLoop}>
          반복
        </Button>
      </div>
      <p className="small dim">FE 드럼 소리로 재연한 정답 연주예요</p>
    </div>
  );
}
