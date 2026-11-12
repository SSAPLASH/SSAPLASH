// 드럼 배치 원근 보기의 캔버스 층(PLAY-004 원근 보기 설계): 바닥 격자·그림자(패드 아래)와 손별 판정 범위·L·R 표식(패드 위).
// 패드 그림은 DrumKit(SVG, 사용자가 고른 스킨)이 그린다. 좌표 계산은 domain/kit/kitPerspective 몫이다.
import { PAD_META, type PadId } from '@/domain/pads';
import { FLOOR_Z, type Camera, type PadShape } from '@/domain/kit/kitPerspective';
import type { Point3 } from '@/domain/kit/kitModel';
import { FONT } from '@/components/drum/kitPadPaint';

/** 손 색(왼손, 오른손). 자세 마커와 판정 범위가 같이 쓴다 */
export const HAND_COLORS = ['#7cc4ff', '#ffa07c'] as const;

const TAU = Math.PI * 2;

/** 캔버스가 그림 영역(폭 w) 바깥으로 넘친 폭(px, 한쪽). 넘침은 CSS가 정한다(드럼 세팅은 판 안쪽 여백만큼). 재지 못하면 0 */
export function canvasBleed(clientWidth: number, w: number): number {
  const b = Math.round((clientWidth - w) / 2);
  return Number.isFinite(b) && b > 0 ? b : 0;
}

/** 바닥 격자(0.2m 간격) */
export function paintFloor(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const line = (a: Point3, b: Point3) => {
    const p = cam.project(a);
    const q = cam.project(b);
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy);
    ctx.lineTo(q.sx, q.sy);
    ctx.stroke();
  };
  for (let i = -6; i <= 6; i++) line([i * 0.2, -0.4, FLOOR_Z], [i * 0.2, 1.4, FLOOR_Z]);
  for (let j = -2; j <= 7; j++) line([-1.2, j * 0.2, FLOOR_Z], [1.2, j * 0.2, FLOOR_Z]);
  ctx.restore();
}

export function paintShadow(ctx: CanvasRenderingContext2D, s: PadShape): void {
  if (!s.shadow) return;
  ctx.beginPath();
  ctx.ellipse(s.shadow.cx, s.shadow.cy, s.shadow.rx, Math.max(1, s.shadow.ry), 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fill();
}

/** 손별 판정 범위: 점선 원(스틱을 향한 면이라 누르지 않는다) + 가운데 패드 색 점 */
export function paintAnchorZone(ctx: CanvasRenderingContext2D, hand: 0 | 1, pad: PadId, sx: number, sy: number, r: number): void {
  const color = HAND_COLORS[hand];
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, TAU);
  ctx.fillStyle = color + '14';
  ctx.fill();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color + '99';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, TAU);
  ctx.fillStyle = PAD_META[pad].color;
  ctx.fill();
  ctx.restore();
}

/** 내 포인터: 스틱이 가리키는 끝점에 손 색 원과 L·R 글자 */
export function paintStickTip(ctx: CanvasRenderingContext2D, hand: 0 | 1, to: { sx: number; sy: number }): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(to.sx, to.sy, 9, 0, TAU);
  ctx.fillStyle = HAND_COLORS[hand];
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0e1320';
  ctx.stroke();
  ctx.fillStyle = '#0e1320';
  ctx.font = `700 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hand === 0 ? 'L' : 'R', to.sx, to.sy + 0.5);
  ctx.restore();
}
