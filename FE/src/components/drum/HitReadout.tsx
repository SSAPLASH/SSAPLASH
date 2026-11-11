import type { PadId } from '@/domain/pads';
import { PAD_META } from '@/domain/pads';
import '@/components/play/play.css';

interface Props {
  /** stack: 연주 화면(두 줄, 180폭) · row: 자유 연습 정보 띠(패드·손·세기 세 칸) */
  variant: 'stack' | 'row';
  pad?: PadId;
  hand?: 'L' | 'R' | null;
  velocity?: number;
}

const DASH = '—';

function handText(hand?: 'L' | 'R' | null): string {
  if (hand === 'L') return '왼손';
  if (hand === 'R') return '오른손';
  return DASH;
}

/** 최근 타격 표시. 값이 없는 칸은 "—" */
export function HitReadout({ variant, pad, hand, velocity }: Props) {
  const padName = pad ? PAD_META[pad].label : DASH;
  const hText = handText(hand);
  const vText = velocity === undefined ? DASH : String(Math.round(velocity));

  if (variant === 'row') {
    return (
      <div className="hit-readout row">
        <div className="hit-readout-cell">
          <span className="hit-readout-key">패드</span>
          <span className="hit-readout-val">{padName}</span>
        </div>
        <div className="hit-readout-cell">
          <span className="hit-readout-key">손</span>
          <span className="hit-readout-val">{hText}</span>
        </div>
        <div className="hit-readout-cell">
          <span className="hit-readout-key">세기</span>
          <span className="hit-readout-val num">{vText}</span>
        </div>
      </div>
    );
  }

  const second = hand || velocity !== undefined ? `${hText} · 세기 ${vText}` : DASH;
  return (
    <div className="hit-readout stack">
      <span className="hit-readout-line1">최근 타격: {padName}</span>
      <span className="hit-readout-line2">{second}</span>
    </div>
  );
}
