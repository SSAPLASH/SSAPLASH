// 시작 위치 보정 자세 안내(PLAY-004): 제목 + 그림 두 장(위·옆) + 세 줄 안내.
// 대기에서는 두 손이 모이고 스틱 끝이 맞닿는 동작(∧)을 되풀이한다. 그림은 안내용 고정 동작이고 실제 센서 값과 무관하다.
// 프레임마다 SVG 속성만 고치고 React 상태는 바꾸지 않는다. 3초 판정·버튼·진행 막대는 SetupPage가 맡는다.
import { useEffect, useRef, useState } from 'react';
import { REFERENCE_POSE_STEPS, REFERENCE_POSE_TITLE } from '@/domain/kit/calibration/setupSteps';
import { POSE_CENTER_X, POSE_HAND_Y, POSE_STICK_LEN, idleProgress, poseAt, shakyJitter, type ReferencePose } from './referencePose';
import '@/components/calibration/calibration.css';

export type ReferencePoseState = 'idle' | 'holding' | 'shaky' | 'done';

export interface ReferencePoseGuideProps {
  state: ReferencePoseState;
  /** 움직임 줄이기 강제(테스트·미리보기). 생략하면 시스템 설정을 따른다 */
  reducedMotion?: boolean;
}

const STICK_W = 6;
const STICK_TOP = POSE_HAND_Y - POSE_STICK_LEN;
/** 옆 그림 손(회전 중심) */
const SIDE_HAND = { x: 126, y: 110 };
const SIDE_STICK_LEN = 76;
const CLOSED = poseAt(1);
const OPEN = poseAt(0);

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

const rot = (deg: number, x: number, y: number) => `rotate(${deg} ${x} ${y})`;

/** 안내 줄 강조: 대기 ①②, 유지·흔들림 ③, 완료 없음 */
function stepOn(state: ReferencePoseState, i: number): boolean {
  if (state === 'idle') return i < 2;
  if (state === 'done') return false;
  return i === 2;
}

function Check({ cx }: { cx: number }) {
  return (
    <g className="pose-guide-check">
      <circle cx={cx} cy={182} r={14} />
      <path d={`M${cx - 7} 182 l5 5 l9 -10`} />
    </g>
  );
}

export function ReferencePoseGuide({ state, reducedMotion }: ReferencePoseGuideProps) {
  const [systemReduced] = useState(prefersReducedMotion);
  const reduced = reducedMotion ?? systemReduced;
  const armL = useRef<SVGLineElement>(null);
  const armR = useRef<SVGLineElement>(null);
  const stickL = useRef<SVGRectElement>(null);
  const stickR = useRef<SVGRectElement>(null);
  const handL = useRef<SVGCircleElement>(null);
  const handR = useRef<SVGCircleElement>(null);
  const tip = useRef<SVGCircleElement>(null);
  const guide = useRef<SVGLineElement>(null);
  const stickS = useRef<SVGRectElement>(null);

  useEffect(() => {
    const apply = (p: ReferencePose) => {
      const xl = POSE_CENTER_X - p.handOffset;
      const xr = POSE_CENTER_X + p.handOffset;
      stickL.current?.setAttribute('x', String(xl - STICK_W / 2));
      stickL.current?.setAttribute('transform', rot(p.leftDeg, xl, POSE_HAND_Y));
      stickR.current?.setAttribute('x', String(xr - STICK_W / 2));
      stickR.current?.setAttribute('transform', rot(p.rightDeg, xr, POSE_HAND_Y));
      handL.current?.setAttribute('cx', String(xl));
      handR.current?.setAttribute('cx', String(xr));
      armL.current?.setAttribute('x2', String(xl));
      armR.current?.setAttribute('x2', String(xr));
      tip.current?.setAttribute('opacity', String((state === 'idle' ? 0.22 : 0.14) * p.near));
      guide.current?.setAttribute('opacity', String(0.15 + 0.7 * p.near));
      stickS.current?.setAttribute('transform', rot(p.sideDeg, SIDE_HAND.x, SIDE_HAND.y));
    };
    const moving = !reduced && (state === 'idle' || state === 'shaky');
    if (!moving) {
      // 유지 중·완료·움직임 줄이기: 모은 자세로 멈춘다
      apply(CLOSED);
      return;
    }
    let raf = 0;
    const frame = (now: number) => {
      apply(state === 'idle' ? poseAt(idleProgress(now)) : poseAt(1, shakyJitter(now)));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state, reduced]);

  const xl = POSE_CENTER_X - CLOSED.handOffset;
  const xr = POSE_CENTER_X + CLOSED.handOffset;
  const oxl = POSE_CENTER_X - OPEN.handOffset;
  const oxr = POSE_CENTER_X + OPEN.handOffset;
  /** 정지 그림의 대기 상태에서만 벌어진 자세 윤곽을 겹친다 */
  const ghost = reduced && state === 'idle';

  return (
    <div className={`pose-guide${reduced ? ' reduced' : ''}`} data-state={state}>
      <p className="pose-guide-title">{REFERENCE_POSE_TITLE}</p>
      <div className="pose-guide-figs">
        <figure className="pose-guide-fig">
          <figcaption>위에서 본 모습</figcaption>
          <svg viewBox="0 0 280 210" role="img" aria-label="화면을 마주 보고 앉아 두 손을 가까이 모으고 스틱 끝을 맞댄 모습">
            <rect className="pose-guide-fill" x={85} y={16} width={110} height={10} rx={4} />
            <text className="pose-guide-label" x={140} y={42} textAnchor="middle">
              화면
            </text>
            <line ref={guide} className="pose-guide-line" x1={140} y1={60} x2={140} y2={48} opacity={0.85} />
            {ghost && (
              <g className="pose-guide-ghost">
                <rect className="pose-guide-stick" x={oxl - STICK_W / 2} y={STICK_TOP} width={STICK_W} height={POSE_STICK_LEN} rx={3} transform={rot(OPEN.leftDeg, oxl, POSE_HAND_Y)} />
                <rect className="pose-guide-stick" x={oxr - STICK_W / 2} y={STICK_TOP} width={STICK_W} height={POSE_STICK_LEN} rx={3} transform={rot(OPEN.rightDeg, oxr, POSE_HAND_Y)} />
              </g>
            )}
            <line ref={armL} className="pose-guide-body" x1={92} y1={178} x2={xl} y2={POSE_HAND_Y} />
            <line ref={armR} className="pose-guide-body" x1={188} y1={178} x2={xr} y2={POSE_HAND_Y} />
            <ellipse className="pose-guide-fill" cx={140} cy={182} rx={56} ry={17} />
            <circle className="pose-guide-fill" cx={140} cy={176} r={15} />
            <circle ref={tip} className="pose-guide-tip" cx={140} cy={66} r={10} opacity={0.14} />
            <rect ref={stickL} className="pose-guide-stick" x={xl - STICK_W / 2} y={STICK_TOP} width={STICK_W} height={POSE_STICK_LEN} rx={3} transform={rot(CLOSED.leftDeg, xl, POSE_HAND_Y)} />
            <rect ref={stickR} className="pose-guide-stick" x={xr - STICK_W / 2} y={STICK_TOP} width={STICK_W} height={POSE_STICK_LEN} rx={3} transform={rot(CLOSED.rightDeg, xr, POSE_HAND_Y)} />
            <circle ref={handL} className="pose-guide-fill" cx={xl} cy={POSE_HAND_Y} r={7} />
            <circle ref={handR} className="pose-guide-fill" cx={xr} cy={POSE_HAND_Y} r={7} />
            {state === 'done' && <Check cx={246} />}
          </svg>
        </figure>
        <figure className="pose-guide-fig">
          <figcaption>옆에서 본 모습</figcaption>
          <svg viewBox="0 0 280 210" role="img" aria-label="팔꿈치를 몸 옆에 편하게 두고 스틱을 화면 쪽으로 든 모습">
            <rect className="pose-guide-fill" x={244} y={52} width={10} height={78} rx={4} />
            <path className="pose-guide-body thin" d="M249 130 V160 M234 160 H264" />
            <text className="pose-guide-label" x={249} y={42} textAnchor="middle">
              화면
            </text>
            {ghost && (
              <g className="pose-guide-ghost">
                <rect className="pose-guide-stick" x={SIDE_HAND.x} y={SIDE_HAND.y - STICK_W / 2} width={SIDE_STICK_LEN} height={STICK_W} rx={3} transform={rot(OPEN.sideDeg, SIDE_HAND.x, SIDE_HAND.y)} />
              </g>
            )}
            <path className="pose-guide-body mid" d="M50 150 H104 M77 150 V190" />
            <path className="pose-guide-body" d="M74 142 L124 144 L126 190" />
            <path className="pose-guide-body" d="M72 78 L74 142" />
            <circle className="pose-guide-fill" cx={72} cy={58} r={15} />
            <path className="pose-guide-body" d="M72 84 L84 118 L124 110" />
            <rect ref={stickS} className="pose-guide-stick" x={SIDE_HAND.x} y={SIDE_HAND.y - STICK_W / 2} width={SIDE_STICK_LEN} height={STICK_W} rx={3} transform={rot(0, SIDE_HAND.x, SIDE_HAND.y)} />
            <circle className="pose-guide-fill" cx={SIDE_HAND.x} cy={SIDE_HAND.y} r={7} />
            {state === 'done' && <Check cx={30} />}
          </svg>
        </figure>
      </div>
      <ol className="pose-guide-steps">
        {REFERENCE_POSE_STEPS.map((text, i) => (
          <li key={text} className={stepOn(state, i) ? 'on' : undefined}>
            <i aria-hidden="true">{i + 1}</i>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
