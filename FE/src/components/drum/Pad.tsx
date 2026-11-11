import { memo } from 'react';
import type { KitSkin, PadBadge, PadShape, PadVisualState } from '@/domain/drumKit';
import { ElectronicPad } from './ElectronicPad';
import { NeonPad } from './NeonPad';
import { RING } from './padRing';
import './drum.css';

/** 원본 패드 폭(px). 모든 좌표는 이 폭 기준이고 w에 맞춰 균등 확대·축소한다 */
const BASE_W = 160;

/** 그라디언트 정의. DrumKit이 <defs>로 한 번 넣고, Pad는 같은 id 접두사로 참조한다 */
export function PadDefs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-drum-head`} cx="0.5" cy="0.45" r="0.55">
        <stop offset="0" stopColor="#FBF9F4" />
        <stop offset="0.55" stopColor="#ECE7DC" />
        <stop offset="0.85" stopColor="#D3CCBE" />
        <stop offset="1" stopColor="#B9B1A2" />
      </radialGradient>
      <linearGradient id={`${id}-drum-rim`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F4F6F9" />
        <stop offset="0.3" stopColor="#9AA2AD" />
        <stop offset="0.55" stopColor="#E8ECF1" />
        <stop offset="0.8" stopColor="#6F7782" />
        <stop offset="1" stopColor="#C9CFD6" />
      </linearGradient>
      <linearGradient id={`${id}-kick-rim`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFFFFF" />
        <stop offset="0.45" stopColor="#D9DDE2" />
        <stop offset="0.7" stopColor="#9EA6B0" />
        <stop offset="1" stopColor="#E8EBEF" />
      </linearGradient>
      <linearGradient id={`${id}-drum-shell`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1A1E25" />
        <stop offset="1" stopColor="#0C0F14" />
      </linearGradient>
      <linearGradient id={`${id}-stand`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#9AA3AD" />
        <stop offset="1" stopColor="#5B636D" />
      </linearGradient>
      <radialGradient id={`${id}-cymbal`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#FBE7A6" />
        <stop offset="0.35" stopColor="#EBC66A" />
        <stop offset="0.75" stopColor="#CF9C3E" />
        <stop offset="1" stopColor="#A06E22" />
      </radialGradient>
      <linearGradient id={`${id}-kick`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1C2129" />
        <stop offset="1" stopColor="#0A0D12" />
      </linearGradient>
      {/* 전자 드럼 스킨 */}
      <linearGradient id={`${id}-el-hoop`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FAFBFC" />
        <stop offset="0.5" stopColor="#DDE0E4" />
        <stop offset="1" stopColor="#B8BDC4" />
      </linearGradient>
      <radialGradient id={`${id}-el-mesh`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#43474E" />
        <stop offset="0.6" stopColor="#2E3137" />
        <stop offset="1" stopColor="#202328" />
      </radialGradient>
      <linearGradient id={`${id}-el-edge`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F3D58A" />
        <stop offset="0.45" stopColor="#C9973A" />
        <stop offset="0.7" stopColor="#E8C46A" />
        <stop offset="1" stopColor="#9C6E22" />
      </linearGradient>
      <radialGradient id={`${id}-el-rubber`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#2C2E33" />
        <stop offset="0.7" stopColor="#191B1E" />
        <stop offset="1" stopColor="#0F1012" />
      </radialGradient>
      <radialGradient id={`${id}-el-bell`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#34373C" />
        <stop offset="1" stopColor="#1C1E21" />
      </radialGradient>
      <linearGradient id={`${id}-el-bolt`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#E9ECEF" />
        <stop offset="1" stopColor="#8A9099" />
      </linearGradient>
    </defs>
  );
}

/** 판정 텍스트 중심 y(원본 좌표) */
const JUDGE_Y: Record<PadShape, number> = { drum: 12, cymbal: 18, kick: -7, pedal: 8 };
/** 라벨 중심 y */
const LABEL_Y: Record<PadShape, number> = { drum: 140, cymbal: 140, kick: 160, pedal: 152 };

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
  badge?: string | PadBadge;
  badgeHighlight?: boolean;
  /** PadDefs와 같은 id */
  defsId: string;
  onClick?: () => void;
  /** 누르는 즉시(click보다 빠르게) 반응할 때 쓴다. onClick과 별개 */
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
  /** 드럼 모양. 기본 acoustic(실물). 전자·네온은 정사각 원형 패드로 그린다 */
  skin?: KitSkin;
  /** 영문 약어(2D 스킨 전용) */
  tag?: string;
  /** 연타마다 바뀌는 값. hit일 때 모션 그룹의 key가 되어 CSS 애니메이션을 재시작한다 */
  hitKey?: number;
  /** 전자·네온 원판의 세로 눌림 배율(원근 자리용). 실물 스킨은 그림이 이미 기울어 있어 쓰지 않는다 */
  tilt?: number;
}

/** 심벌 광택 부채꼴(원뿔 그라디언트 근사). 중심 (80,70)에서 원판 가장자리까지, 각도는 도 단위 */
function glintPath(from: number, to: number): string {
  const pt = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return `${(80 + 79 * Math.cos(r)).toFixed(1)},${(70 + 39 * Math.sin(r)).toFixed(1)}`;
  };
  return `M80,70 L${pt(from)} A79,39 0 0 1 ${pt(to)} Z`;
}
const CYMBAL_GLINTS: Array<[number, number]> = [
  [-80, -50],
  [10, 35],
  [100, 130],
  [190, 215],
];

function PadBody({ shape, defsId, motionKey }: { shape: PadShape; defsId: string; motionKey: string }) {
  if (shape === 'drum') {
    return (
      <>
        <path
          d="M1,72 V116 A79,23 0 0 0 159,116 V72 Z"
          fill={`url(#${defsId}-drum-shell)`}
          stroke="#2A303A"
          strokeWidth="2"
        />
        <ellipse cx="80" cy="72" rx="76" ry="44" fill={`url(#${defsId}-drum-head)`} stroke={`url(#${defsId}-drum-rim)`} strokeWidth="6" />
        <ellipse cx="80" cy="72" rx="70" ry="42" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" />
      </>
    );
  }
  if (shape === 'cymbal') {
    return (
      <>
        <rect x="77" y="70" width="6" height="80" fill={`url(#${defsId}-stand)`} />
        {/* 원판만 흔들리도록 스탠드와 분리 */}
        <g key={motionKey} className="drum-pad-cymbal">
          <ellipse cx="80" cy="70" rx="79" ry="39" fill={`url(#${defsId}-cymbal)`} stroke="#8A6420" strokeWidth="2" />
          <ellipse cx="80" cy="70" rx="72" ry="36" fill="none" stroke="#7A5A1C" strokeOpacity="0.35" strokeWidth="0.75" />
          <ellipse cx="80" cy="70" rx="64" ry="32" fill="none" stroke="#8A6420" strokeOpacity="0.45" />
          <ellipse cx="80" cy="70" rx="56" ry="28" fill="none" stroke="#7A5A1C" strokeOpacity="0.35" strokeWidth="0.75" />
          <ellipse cx="80" cy="70" rx="48" ry="24" fill="none" stroke="#8A6420" strokeOpacity="0.45" />
          <ellipse cx="80" cy="70" rx="40" ry="20" fill="none" stroke="#7A5A1C" strokeOpacity="0.35" strokeWidth="0.75" />
          <ellipse cx="80" cy="70" rx="32" ry="16" fill="none" stroke="#8A6420" strokeOpacity="0.45" />
          {CYMBAL_GLINTS.map(([from, to]) => (
            <path key={from} className="drum-pad-glint" d={glintPath(from, to)} fill="#fff" fillOpacity="0.18" />
          ))}
          <ellipse cx="80" cy="70" rx="14" ry="7" fill="#E3B24E" stroke="#8A6420" strokeWidth="1" />
          <rect x="76" y="60" width="8" height="8" rx="2" fill="#5B636D" />
        </g>
      </>
    );
  }
  if (shape === 'pedal') {
    // 하이햇 페달: 금속 발판(위가 좁다) + 가로 홈 + 뒤꿈치 판 + 위로 올라가는 연결 막대
    return (
      <>
        <rect x="77" y="6" width="6" height="30" fill={`url(#${defsId}-stand)`} />
        <path d="M60,28 H100 L114,128 Q114,136 106,136 H54 Q46,136 46,128 Z" fill={`url(#${defsId}-drum-rim)`} stroke="#2A303A" strokeWidth="2" />
        {[48, 64, 80, 96].map((y) => (
          <line key={y} x1={60 - (y - 28) * 0.1} y1={y} x2={100 + (y - 28) * 0.1} y2={y} stroke="#2A303A" strokeOpacity="0.55" strokeWidth="2" />
        ))}
        <path d="M50,112 H110 L114,128 Q114,136 106,136 H54 Q46,136 46,128 Z" fill={`url(#${defsId}-drum-shell)`} stroke="#2A303A" strokeWidth="2" />
      </>
    );
  }
  return (
    <>
      <circle cx="80" cy="85" r="76" fill={`url(#${defsId}-kick)`} stroke={`url(#${defsId}-kick-rim)`} strokeWidth="8" />
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
  onPointerDown,
  skin = 'acoustic',
  tag,
  hitKey,
  tilt,
}: PadProps) {
  const s = w / BASE_W;
  const ring = RING[shape];
  const showRing = state !== 'idle';
  const ringWidth = state === 'armed' ? 3 : 5;
  // 헤드 flash는 drum·cymbal의 hit에만
  const flash = state === 'hit' && shape !== 'kick' && shape !== 'pedal';
  const judge = JUDGE_TEXT[state];
  // 문자열 배지는 next. now이거나 badgeHighlight면 강조 모양
  const badgeObj: PadBadge | undefined = typeof badge === 'string' ? { text: badge, level: 'next' } : badge;
  const badgeText = badgeObj?.text;
  const badgeLevel = badgeHighlight ? 'now' : badgeObj?.level;
  const badgeNow = badgeLevel === 'now';
  const badgeOffGrid = badgeObj?.offGrid === true;
  // hit이면 hitKey가 바뀔 때마다 모션 그룹을 새로 마운트해 애니메이션을 재시작한다
  const motionKey = state === 'hit' ? `hit${hitKey ?? 0}` : 'rest';
  const flat = skin !== 'acoustic';

  return (
    <g
      className={onClick ? 'drum-pad clickable' : 'drum-pad'}
      data-state={state}
      data-shape={shape}
      data-skin={flat ? skin : undefined}
      transform={`translate(${left} ${top}) scale(${s})`}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {flat ? (
        skin === 'electronic' ? (
          <ElectronicPad shape={shape} state={state} defsId={defsId} tag={tag} label={label} labelVisible={labelVisible} hitKey={hitKey} tilt={tilt} />
        ) : (
          <NeonPad shape={shape} state={state} defsId={defsId} tag={tag} label={label} labelVisible={labelVisible} hitKey={hitKey} tilt={tilt} />
        )
      ) : (
        <>
          {/* 타격 모션은 몸체에만 건다(바깥 g의 transform 속성과 충돌 방지) */}
          <g key={motionKey} className="drum-pad-body">
            <PadBody shape={shape} defsId={defsId} motionKey={motionKey} />
            {flash && (
              <ellipse className="drum-pad-flash" cx="80" cy={ring.cy} rx="80" ry={shape === 'drum' ? 48 : 40} />
            )}
          </g>
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
            <text key={state} className={`drum-pad-judge ${state}`} x="80" y={JUDGE_Y[shape]} dominantBaseline="central">
              {judge}
            </text>
          )}
          {labelVisible && (
            <text className="drum-pad-label" x="80" y={LABEL_Y[shape]} fontSize="12" dominantBaseline="central">
              {label}
            </text>
          )}
        </>
      )}
      {badge && (
        <g transform="translate(80 12)" className={badgeLevel === 'later' ? 'drum-pad-badge later' : 'drum-pad-badge'}>
          <rect
            className={badgeNow ? 'drum-pad-badge-bg highlight' : 'drum-pad-badge-bg'}
            x="-18"
            y="-11"
            width="36"
            height="22"
            rx="11"
          />
          <text className={badgeNow ? 'drum-pad-badge-text highlight' : 'drum-pad-badge-text'}>{badgeText}</text>
          {badgeOffGrid && <circle className="drum-pad-badge-dot" cx="17" cy="-10" r="2.5" />}
        </g>
      )}
    </g>
  );
});
