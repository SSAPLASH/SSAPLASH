// 실물 드럼 패드 한 개(이미지). Pad의 바깥 g(translate·scale) 안에서 "그림 단위"(조각 상자의 폭 160)로 그린다.
// 조각 이미지 위에 번쩍임·상태 링·판정 글자·라벨을 그 패드의 헤드 자리(domain/kit/kitArt)에 얹는다.
import type { CSSProperties } from 'react';
import type { KitView, PadVisualState } from '@/domain/kit/drumKit';
import type { KitArtPad } from '@/domain/kit/kitArt';
import { spriteUrl } from './sprites';

const JUDGE_TEXT: Partial<Record<PadVisualState, string>> = {
  perfect: 'PERFECT',
  good: 'GOOD',
  miss: 'MISS',
};

interface Props {
  art: KitArtPad;
  state: PadVisualState;
  label: string;
  labelVisible: boolean;
  /** 연타마다 바뀌는 값. hit일 때 모션 그룹의 key가 되어 CSS 애니메이션을 재시작한다 */
  hitKey?: number;
  /** 글자·링 굵기 배율(그림 단위). 조각 상자 폭이 패드마다 달라 Pad가 정해 준다 */
  k: number;
  /**
   * 그리는 층. 심벌(top 있는 패드)은 받침 조각이 길어 가까운 패드 위로 겹쳐 그려지므로 DrumKit이 두 번에 나눠 그린다.
   * all = 전부(기본), over = 받침 이미지만 뺀 나머지(원판·번쩍임·링·글자), 받침은 AcousticUnder가 먼저 그린다
   */
  layer?: 'all' | 'over';
  /** 하이햇 원판(closeDy 있는 패드)·페달: 닫힘(밟힘) 여부. 없으면 닫힘으로 그린다 */
  closed?: boolean;
  /** 페달 패드: 왼발 페달이 연결되지 않음(어둡게) */
  pedalOff?: boolean;
  /** 하이햇 페달을 밟을 때마다 바뀌는 값. 0보다 크면 바뀔 때 "칙" 모션을 다시 재생한다 */
  pedalHitSeq?: number;
  /** 그림 종류. 기본 persp(원근) */
  view?: KitView;
}

/** 심벌 받침 조각(스탠드, 하이햇은 아래 심벌 포함). 자유 틀에서 모든 패드보다 먼저 깔린다 */
export function AcousticUnder({ art, view = 'persp' }: { art: KitArtPad; view?: KitView }) {
  return <image className="drum-pad-art" href={spriteUrl(art.sprite, view)} width="160" height={art.boxH} preserveAspectRatio="none" />;
}

/** 하이햇 페달 이미지. 밟힘 자세(data-pressed)·연결 없음(data-off)·"칙" 모션(data-pulse)은 CSS가 그린다 */
function PedalImage({ art, closed, pedalOff, pedalHitSeq, view }: { art: KitArtPad; closed: boolean; pedalOff: boolean; pedalHitSeq?: number; view: KitView }) {
  const pulse = (pedalHitSeq ?? 0) > 0;
  return (
    <g className="drum-pad-pedal" data-pressed={closed && !pedalOff ? '' : undefined} data-off={pedalOff ? '' : undefined}>
      {/* key가 바뀌면 새로 마운트되어 애니메이션이 처음부터 다시 돈다 */}
      <g key={`pulse${pedalHitSeq ?? 0}`} className="drum-pad-pedal-pulse" data-pulse={pulse ? '' : undefined}>
        <AcousticUnder art={art} view={view} />
      </g>
    </g>
  );
}

/** 심벌 원판. 하이햇(closeDy 있음)은 열림·닫힘 이동과 페달 "칙" 모션 그룹이 바깥에 더 있다. 타격 흔들림은 가장 안쪽 */
function CymbalTop({
  top,
  motionKey,
  closed,
  pedalHitSeq,
  view,
}: {
  top: NonNullable<KitArtPad['top']>;
  motionKey: string;
  closed: boolean;
  pedalHitSeq?: number;
  view: KitView;
}) {
  const disc = (
    <g key={motionKey} className="drum-pad-cymbal">
      <image className="drum-pad-art" href={spriteUrl(top.sprite, view)} x={top.x} y={top.y} width={top.w} height={top.h} preserveAspectRatio="none" />
    </g>
  );
  if (top.closeDy === undefined) return disc;
  return (
    <g
      className="drum-pad-top"
      data-closed={closed ? '' : undefined}
      style={{ '--close-dy': `${top.closeDy}px` } as CSSProperties}
    >
      <g key={`pulse${pedalHitSeq ?? 0}`} className="drum-pad-pulse" data-pulse={(pedalHitSeq ?? 0) > 0 ? '' : undefined}>
        {disc}
      </g>
    </g>
  );
}

export function AcousticPad({ art, state, label, labelVisible, hitKey, k, layer = 'all', closed = true, pedalOff = false, pedalHitSeq, view = 'persp' }: Props) {
  const { head, ring, shape, top } = art;
  // hit이면 hitKey가 바뀔 때마다 모션 그룹을 새로 마운트해 애니메이션을 재시작한다
  const motionKey = state === 'hit' ? `hit${hitKey ?? 0}` : 'rest';
  // 헤드 번쩍임은 드럼·심벌의 hit에만
  const flash = state === 'hit' && shape !== 'kick' && shape !== 'pedal';
  const judge = JUDGE_TEXT[state];
  const ringWidth = (state === 'armed' ? 3 : 5) * k;

  return (
    <>
      {/* 타격 모션은 몸체에만 건다(바깥 g의 transform 속성과 충돌 방지).
          심벌 몸체는 흔들림 그룹(원판)만 key로 재시작해, 하이햇 "칙" 모션이 스틱 타격마다 다시 돌지 않게 한다 */}
      <g key={top ? 'body' : motionKey} className="drum-pad-body">
        {layer === 'over' ? (
          // 받침이 빠져도 조각 상자 크기를 유지해 바깥 그룹의 확대 모션 기준점이 받침 층과 같게 한다
          <rect className="drum-pad-box" width="160" height={art.boxH} fill="none" />
        ) : shape === 'pedal' ? (
          <PedalImage art={art} closed={closed} pedalOff={pedalOff} pedalHitSeq={pedalHitSeq} view={view} />
        ) : (
          <AcousticUnder art={art} view={view} />
        )}
        {top && <CymbalTop top={top} motionKey={motionKey} closed={closed} pedalHitSeq={pedalHitSeq} view={view} />}
        {flash && <ellipse className="drum-pad-flash" cx={head.cx} cy={head.cy} rx={head.rx} ry={head.ry} />}
      </g>
      {/* 누름 영역: 조각 상자끼리 겹치므로 이미지가 아니라 헤드 타원이 받는다 */}
      <ellipse className="drum-pad-hitarea" cx={head.cx} cy={head.cy} rx={head.rx} ry={head.ry} />
      {state !== 'idle' && (
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
        <g transform={`translate(${art.judge.x} ${art.judge.y}) scale(${k})`}>
          <text key={state} className={`drum-pad-judge ${state}`} dominantBaseline="central">
            {judge}
          </text>
        </g>
      )}
      {labelVisible && (
        <g transform={`translate(${art.label.x} ${art.label.y}) scale(${k})`}>
          <text className="drum-pad-label" fontSize="12" dominantBaseline="central">
            {label}
          </text>
        </g>
      )}
    </>
  );
}
