import { memo } from 'react';
import type { PadShape, PadVisualState } from '@/domain/drumKit';
import './drum.css';

/** 원본 패드 폭(px). 모든 좌표는 이 폭 기준이고 w에 맞춰 균등 확대·축소한다 */
const BASE_W = 160;

/** 그라디언트 정의. DrumKit이 <defs>로 한 번 넣고, Pad는 같은 id 접두사로 참조한다 */
export function PadDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-drum-head`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F2F0EA" />
        <stop offset="1" stopColor="#CFCBC2" />
      </linearGradient>
      <linearGradient id={`${id}-drum-shell`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1A1E25" />
        <stop offset="1" stopColor="#0C0F14" />
      </linearGradient>
      <linearGradient id={`${id}-stand`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#9AA3AD" />
        <stop offset="1" stopColor="#5B636D" />
      </linearGradient>
      <linearGradient id={`${id}-cymbal`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#F1CF74" />
        <stop offset="1" stopColor="#B8872C" />
      </linearGradient>
      <linearGradient id={`${id}-kick`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1C2129" />
        <stop offset="1" stopColor="#0A0D12" />
      </linearGradient>
    </defs>
  );
}

interface RingGeo {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** 링 기하(원본 160 기준). 헤드 중심에서 rx 86 */
const RING: Record<PadShape, RingGeo> = {
  drum: { cx: 80, cy: 72, rx: 86, ry: 54 },
  cymbal: { cx: 80, cy: 70, rx: 86, ry: 46 },
  kick: { cx: 80, cy: 85, rx: 86, ry: 86 },
};

/** 판정 텍스트 중심 y(원본 좌표) */
const JUDGE_Y: Record<PadShape, number> = { drum: 12, cymbal: 18, kick: -7 };
/** 라벨 중심 y */
const LABEL_Y: Record<PadShape, number> = { drum: 140, cymbal: 140, kick: 160 };

const JUDGE_TEXT: Partial<Record<PadVisualState, string>> = {
  perfect: 'PERFECT',
  good: 'GOOD',
  miss: 'MISS',
};

interface PadProps {
  shape: PadShape;
  /** 킷 좌표계에서의 위치·폭. 높이는 폭 비율로 정해진다 */
  left: number;
  top: number;
  w: number;
  state?: PadVisualState;
  label: string;
  labelVisible?: boolean;
  /** 패드 위쪽 가운데 알약 배지(예: 다음 박 번호) */
  badge?: string;
  badgeHighlight?: boolean;
  /** PadDefs와 같은 id */
  defsId: string;
  onClick?: () => void;
}

function PadBody({ shape, defsId }: { shape: PadShape; defsId: string }) {
  if (shape === 'drum') {
    return (
      <>
        <path
          d="M1,72 V116 A79,23 0 0 0 159,116 V72 Z"
          fill={`url(#${defsId}-drum-shell)`}
          stroke="#2A303A"
          strokeWidth="2"
        />
        <ellipse cx="80" cy="72" rx="76" ry="44" fill={`url(#${defsId}-drum-head)`} stroke="#B7BEC8" strokeWidth="8" />
        <ellipse cx="80" cy="72" rx="70" ry="42" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" />
      </>
    );
  }
  if (shape === 'cymbal') {
    return (
      <>
        <rect x="77" y="70" width="6" height="80" fill={`url(#${defsId}-stand)`} />
        <ellipse cx="80" cy="70" rx="79" ry="39" fill={`url(#${defsId}-cymbal)`} stroke="#8A6420" strokeWidth="2" />
        <ellipse cx="80" cy="70" rx="64" ry="32" fill="none" stroke="#8A6420" strokeOpacity="0.45" />
        <ellipse cx="80" cy="70" rx="48" ry="24" fill="none" stroke="#8A6420" strokeOpacity="0.45" />
        <ellipse cx="80" cy="70" rx="32" ry="16" fill="none" stroke="#8A6420" strokeOpacity="0.45" />
        <ellipse cx="80" cy="70" rx="14" ry="7" fill="#E3B24E" stroke="#8A6420" strokeWidth="1" />
        <rect x="76" y="60" width="8" height="8" rx="2" fill="#5B636D" />
      </>
    );
  }
  return (
    <>
      <circle cx="80" cy="85" r="76" fill={`url(#${defsId}-kick)`} stroke="#E8E6E0" strokeWidth="8" />
      <circle cx="80" cy="85" r="58" fill="none" stroke="#2A303A" strokeWidth="2" />
      <circle cx="80" cy="120.2" r="16" fill="#0A0D12" stroke="#3A4250" strokeWidth="2" />
    </>
  );
}

/** 패드 하나(SVG <g>). 원본 160 기준으로 그리고 w에 맞춰 확대·축소한다. 상태 타이머는 없다 */
export const Pad = memo(function Pad({
  shape,
  left,
  top,
  w,
  state = 'idle',
  label,
  labelVisible = true,
  badge,
  badgeHighlight = false,
  defsId,
  onClick,
}: PadProps) {
  const s = w / BASE_W;
  const ring = RING[shape];
  const showRing = state !== 'idle';
  const ringWidth = state === 'armed' ? 3 : 5;
  // 헤드 flash는 drum·cymbal의 hit에만
  const flash = state === 'hit' && shape !== 'kick';
  const judge = JUDGE_TEXT[state];

  return (
    <g
      className={onClick ? 'drum-pad clickable' : 'drum-pad'}
      data-state={state}
      transform={`translate(${left} ${top}) scale(${s})`}
      onClick={onClick}
    >
      <PadBody shape={shape} defsId={defsId} />
      {flash && (
        <ellipse className="drum-pad-flash" cx="80" cy={ring.cy} rx="80" ry={shape === 'drum' ? 48 : 40} />
      )}
      {showRing && (
        <ellipse
          className={`drum-pad-ring ${state}`}
          cx={ring.cx}
          cy={ring.cy}
          rx={ring.rx - ringWidth / 2}
          ry={ring.ry - ringWidth / 2}
          strokeWidth={ringWidth}
        />
      )}
      {judge && (
        <text className={`drum-pad-judge ${state}`} x="80" y={JUDGE_Y[shape]} dominantBaseline="central">
          {judge}
        </text>
      )}
      {labelVisible && (
        <text className="drum-pad-label" x="80" y={LABEL_Y[shape]} fontSize="12" dominantBaseline="central">
          {label}
        </text>
      )}
      {badge && (
        <g transform="translate(80 12)">
          <rect
            className={badgeHighlight ? 'drum-pad-badge-bg highlight' : 'drum-pad-badge-bg'}
            x="-18"
            y="-11"
            width="36"
            height="22"
            rx="11"
          />
          <text className={badgeHighlight ? 'drum-pad-badge-text highlight' : 'drum-pad-badge-text'}>{badge}</text>
        </g>
      )}
    </g>
  );
});
