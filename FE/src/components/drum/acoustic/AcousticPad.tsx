// 실물 드럼 패드 한 개(이미지). Pad의 바깥 g(translate·scale) 안에서 "그림 단위"(조각 상자의 폭 160)로 그린다.
// 조각 이미지 위에 번쩍임·상태 링·판정 글자·라벨을 그 패드의 헤드 자리(domain/kit/kitArt)에 얹는다.
import type { PadVisualState } from '@/domain/drumKit';
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
}

export function AcousticPad({ art, state, label, labelVisible, hitKey, k }: Props) {
  const { head, ring, shape, top } = art;
  // hit이면 hitKey가 바뀔 때마다 모션 그룹을 새로 마운트해 애니메이션을 재시작한다
  const motionKey = state === 'hit' ? `hit${hitKey ?? 0}` : 'rest';
  // 헤드 번쩍임은 드럼·심벌의 hit에만
  const flash = state === 'hit' && shape !== 'kick' && shape !== 'pedal';
  const judge = JUDGE_TEXT[state];
  const ringWidth = (state === 'armed' ? 3 : 5) * k;

  return (
    <>
      {/* 타격 모션은 몸체에만 건다(바깥 g의 transform 속성과 충돌 방지) */}
      <g key={motionKey} className="drum-pad-body">
        <image className="drum-pad-art" href={spriteUrl(art.sprite)} width="160" height={art.boxH} preserveAspectRatio="none" />
        {top && (
          // 심벌은 원판만 흔들리도록 스탠드와 조각이 나뉘어 있다
          <g className="drum-pad-cymbal">
            <image className="drum-pad-art" href={spriteUrl(top.sprite)} x={top.x} y={top.y} width={top.w} height={top.h} preserveAspectRatio="none" />
          </g>
        )}
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
