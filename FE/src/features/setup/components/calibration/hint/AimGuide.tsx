// ③ 방향 그림(PLAY-004 v0.4 D18): 타격이 오래 안 잡힐 때 그림 영역 위쪽 모서리에 뜨는 작은 유리판 카드. 위·옆 두 그림에서 스틱이 정면에서 그 패드 방향으로 가 한 번 친다.
// 방향은 3D 모델의 가정값(hintGeometry.aimPose)이고 각도 숫자는 쓰지 않는다. 손 색은 --left·--right. 움직임은 hint.css.
import type { CSSProperties } from 'react';
import { HAND_NAME } from '@/components/calibration/calibrationText';
import type { StickId } from '@/domain/events';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { aimPose } from './hintGeometry';
import './hint.css';

export interface AimGuideProps {
  pad: PadId;
  stickId: StickId;
  /** 카드를 둘 쪽(칠 패드의 반대편) */
  side: 'left' | 'right';
}

/** 스틱 길이(그림 단위) */
const R = 46;
const RAD = Math.PI / 180;

function Tip({ x, y }: { x: number; y: number }) {
  return (
    <>
      <circle className="cal-aim-tipring" cx={x} cy={y} r={3} />
      <circle className="cal-aim-tipdot" cx={x} cy={y} r={2.6} />
    </>
  );
}

export function AimGuide({ pad, stickId, side }: AimGuideProps) {
  const pose = aimPose(stickId, pad);
  if (!pose) return null;
  const label = PAD_META[pad].label;
  // 위 그림: 손(hx, 70)이 회전 중심, 정면(위쪽)에서 yaw만큼 시계 방향
  const hx = stickId === 0 ? 56 : 84;
  const tx = hx + R * Math.sin(pose.yaw * RAD);
  const ty = 70 - R * Math.cos(pose.yaw * RAD);
  // 옆 그림: 손(66, 60)이 회전 중심, 화면 쪽(오른쪽)에서 pitch만큼 위로
  const sx = 66 + R * Math.cos(pose.pitch * RAD);
  const sy = 60 - R * Math.sin(pose.pitch * RAD);
  const topStick = { transformOrigin: `${hx}px 70px`, '--to': `${pose.yaw}deg`, '--tap': '0deg' } as CSSProperties;
  const sideStick = { transformOrigin: '66px 60px', '--to': `${-pose.pitch}deg`, '--tap': '9deg' } as CSSProperties;
  return (
    <div className="cal-aim" role="status" aria-label={`${HAND_NAME[stickId]} ${label} 방향 안내`} data-hand={stickId} data-side={side} data-testid="cal-aim">
      <figure>
        <figcaption>위에서 본 모습</figcaption>
        <svg viewBox="0 0 140 104" aria-hidden="true">
          <rect className="cal-aim-fill" x={45} y={4} width={50} height={5} rx={2} />
          <line className="cal-aim-body" x1={stickId === 0 ? 46 : 94} y1={92} x2={hx} y2={70} />
          <ellipse className="cal-aim-fill" cx={70} cy={94} rx={30} ry={9} />
          <circle className="cal-aim-fill" cx={70} cy={90} r={8} />
          <path className="cal-aim-arc" pathLength={1} d={`M${hx} ${70 - R} A${R} ${R} 0 0 ${pose.yaw > 0 ? 1 : 0} ${tx} ${ty}`} />
          <rect className="cal-aim-stick" x={hx - 2} y={70 - R} width={4} height={R} rx={2} style={topStick} />
          <circle className="cal-aim-fill" cx={hx} cy={70} r={4} />
          <Tip x={tx} y={ty} />
        </svg>
      </figure>
      <figure>
        <figcaption>옆에서 본 모습</figcaption>
        <svg viewBox="0 0 140 104" aria-hidden="true">
          <path className="cal-aim-body" d="M34 44 L36 78 L64 80 L66 100" />
          <circle className="cal-aim-fill" cx={34} cy={30} r={8} />
          <path className="cal-aim-body" d="M35 46 L44 66 L66 60" />
          <path className="cal-aim-arc" pathLength={1} d={`M${66 + R} 60 A${R} ${R} 0 0 ${pose.pitch > 0 ? 0 : 1} ${sx} ${sy}`} />
          <rect className="cal-aim-stick" x={66} y={58} width={R} height={4} rx={2} style={sideStick} />
          <circle className="cal-aim-fill" cx={66} cy={60} r={4} />
          <Tip x={sx} y={sy} />
        </svg>
      </figure>
    </div>
  );
}
