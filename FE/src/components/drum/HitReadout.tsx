import type { PadId } from '@/domain/kit/pads';
import { PAD_META } from '@/domain/kit/pads';
import './HitReadout.css';

interface Props {
  /** stack: 연주 화면(두 줄, 180폭) */
  variant: 'stack';
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

  const second = hand || velocity !== undefined ? `${hText} · 세기 ${vText}` : DASH;
  return (
    <div className={`hit-readout ${variant}`}>
      <span className="hit-readout-line1">최근 타격: {padName}</span>
      <span className="hit-readout-line2">{second}</span>
    </div>
  );
}
