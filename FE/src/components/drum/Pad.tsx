import { memo } from 'react';
import type { KitSkin, KitView, PadBadge, PadShape, PadVisualState } from '@/domain/kit/drumKit';
import type { KitArtPad } from '@/domain/kit/kitArt';
import { AcousticPad, AcousticUnder } from './acoustic/AcousticPad';
import { ElectronicPad } from './ElectronicPad';
import { NeonPad } from './NeonPad';
import './drum.css';

/** 원본 패드 폭(px). 모든 좌표는 이 폭 기준이고 w에 맞춰 균등 확대·축소한다 */
const BASE_W = 160;

/**
 * 옛 벡터 실물 그림에서 헤드 가로 반지름(원본 160 기준).
 * 자유 틀에서 실물 패드의 글자·링 굵기를 헤드 크기에 맞춰 예전과 같은 비율로 그리려고 남겨 둔다
 */
const OLD_HEAD_RX: Record<PadShape, number> = { drum: 79, cymbal: 79, kick: 80, pedal: 34 };

/** 그라디언트 정의(전자 드럼 스킨). DrumKit이 <defs>로 한 번 넣고, 패드는 같은 id 접두사로 참조한다. 실물 스킨은 이미지라 쓰지 않는다 */
export function PadDefs({ id }: { id: string }) {
  return (
    <defs>
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
  /** 실물 스킨: 이 패드 그림의 자리(domain/kit/kitArt). 실물인데 없으면 그림을 그리지 않는다 */
  art?: KitArtPad;
  /**
   * 실물 스킨의 글자 크기 배율(킷 단위). 주면 패드 크기와 무관하게 모든 패드의 글자가 같은 크기다(고정 배치).
   * 없으면 헤드 크기에 비례한다(자유 틀: 먼 패드의 글자가 작다)
   */
  textSize?: number;
  /** 영문 약어(2D 스킨 전용) */
  tag?: string;
  /** 연타마다 바뀌는 값. hit일 때 모션 그룹의 key가 되어 CSS 애니메이션을 재시작한다 */
  hitKey?: number;
  /** 전자·네온 원판의 세로 눌림 배율(원근 자리용). 실물 스킨은 그림이 이미 기울어 있어 쓰지 않는다 */
  tilt?: number;
  /**
   * 실물 심벌의 그리는 층(자유 틀 겹침 순서). 기본 all = 한 번에 전부.
   * under = 받침 조각만(모든 패드보다 먼저 깔 때), over = 받침을 뺀 나머지. 받침이 없는 패드·전자·네온은 all만 쓴다
   */
  layer?: 'all' | 'under' | 'over';
  /** 실물 하이햇·하이햇 페달: 닫힘(밟힘) 여부. 없으면 닫힘 */
  closed?: boolean;
  /** 실물 하이햇 페달: 왼발 페달이 연결되지 않음 */
  pedalOff?: boolean;
  /** 실물 하이햇·페달: 페달을 밟을 때마다 바뀌는 값("칙" 모션 재시작) */
  pedalHitSeq?: number;
  /** 실물 스킨의 그림 종류(조각 이미지 폴더). 기본 persp */
  view?: KitView;
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
  art,
  textSize,
  tag,
  hitKey,
  tilt,
  layer = 'all',
  closed,
  pedalOff,
  pedalHitSeq,
  view = 'persp',
}: PadProps) {
  const s = w / BASE_W;
  // 문자열 배지는 next. now이거나 badgeHighlight면 강조 모양
  const badgeObj: PadBadge | undefined = typeof badge === 'string' ? { text: badge, level: 'next' } : badge;
  const badgeText = badgeObj?.text;
  const badgeLevel = badgeHighlight ? 'now' : badgeObj?.level;
  const badgeNow = badgeLevel === 'now';
  const badgeOffGrid = badgeObj?.offGrid === true;
  const flat = skin !== 'acoustic';
  const image = flat ? undefined : art;
  // 실물: 조각 상자 폭이 패드마다 달라 글자·배지·링 굵기를 따로 맞춘다
  const k = image ? (textSize !== undefined ? textSize / s : image.head.rx / OLD_HEAD_RX[shape]) : 1;

  // 받침 층: 받침 이미지만 같은 자리·크기로 그린다(누름·상태·배지는 over 층의 몫)
  if (layer === 'under') {
    return (
      <g className="drum-pad-under" data-shape={shape} transform={`translate(${left} ${top}) scale(${s})`}>
        {image && <AcousticUnder art={image} view={view} />}
      </g>
    );
  }

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
        image && <AcousticPad art={image} state={state} label={label} labelVisible={labelVisible} hitKey={hitKey} k={k} layer={layer} closed={closed} pedalOff={pedalOff} pedalHitSeq={pedalHitSeq} view={view} />
      )}
      {badge && (
        <g
          transform={image ? `translate(${image.badge.x} ${image.badge.y}) scale(${k})` : 'translate(80 12)'}
          className={badgeLevel === 'later' ? 'drum-pad-badge later' : 'drum-pad-badge'}
        >
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
