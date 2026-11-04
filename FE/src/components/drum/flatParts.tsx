// 전자·네온 스킨이 같이 쓰는 조각: 타격 모션 그룹, 판정 링, 글자. 원본 160 좌표, 원 중심 (80,80)
import type { ReactNode } from 'react';
import type { PadShape, PadVisualState } from '@/domain/drumKit';

export interface FlatSkinProps {
  shape: PadShape;
  state: PadVisualState;
  /** PadDefs와 같은 id */
  defsId: string;
  tag?: string;
  label: string;
  labelVisible: boolean;
  /** 연타마다 바뀌는 값. hit일 때 모션 그룹의 key로 써서 CSS 애니메이션을 재시작한다 */
  hitKey?: number;
}

const JUDGE_TEXT: Partial<Record<PadVisualState, string>> = {
  perfect: 'PERFECT',
  good: 'GOOD',
  miss: 'MISS',
};

/** 판정 텍스트 중심 y */
const JUDGE_Y: Record<PadShape, number> = { drum: 40, cymbal: 36, kick: 40 };

/** 타격 모션 그룹. drum·kick은 눌림(.drum-pad-body), cymbal은 흔들림(.drum-pad-cymbal) */
export function FlatMotion({
  shape,
  state,
  hitKey,
  children,
}: {
  shape: PadShape;
  state: PadVisualState;
  hitKey?: number;
  children: ReactNode;
}) {
  return (
    <g
      key={state === 'hit' ? `hit${hitKey ?? 0}` : 'rest'}
      className={shape === 'cymbal' ? 'drum-pad-cymbal' : 'drum-pad-body'}
    >
      {children}
    </g>
  );
}

/** 판정(perfect/good/miss) 링. 원, 중심 (80,80), 바깥 반지름 84 */
export function FlatJudgeRing({ state }: { state: PadVisualState }) {
  if (!JUDGE_TEXT[state]) return null;
  const width = 5;
  return <circle className={`drum-pad-ring ${state}`} cx="80" cy="80" r={84 - width / 2} strokeWidth={width} />;
}

/** 태그(영문 약어)·라벨·판정 글자. tagTop은 태그 윗변 y */
export function FlatTexts({
  shape,
  state,
  tag,
  label,
  labelVisible,
  tagTop,
}: Pick<FlatSkinProps, 'shape' | 'state' | 'tag' | 'label' | 'labelVisible'> & { tagTop: number }) {
  const judge = JUDGE_TEXT[state];
  return (
    <>
      {judge && (
        <text key={state} className={`drum-pad-judge ${state}`} x="80" y={JUDGE_Y[shape]} dominantBaseline="central">
          {judge}
        </text>
      )}
      {labelVisible && tag && (
        <text className="drum-pad-tag" x="80" y={tagTop} dominantBaseline="hanging">
          {tag}
        </text>
      )}
      {labelVisible && (
        <text className="drum-pad-label" x="80" y={tagTop + 23} dominantBaseline="central">
          {label}
        </text>
      )}
    </>
  );
}

/** 원 둘레 균등 배치 좌표(맨 위부터 시계 방향) */
export function onCircle(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
