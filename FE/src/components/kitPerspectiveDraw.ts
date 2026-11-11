// 드럼 배치 원근 보기 그리기(PLAY-004 원근 보기 설계). 좌표 계산은 domain/kitPerspective 몫이고 여기는 캔버스에 칠하는 일만 한다.
import { PAD_META, type PadId } from '@/domain/pads';
import type { HitFx } from '@/domain/events';
import { FLOOR_Z, type Camera, type PadShape } from '@/domain/kitPerspective';
import type { Point3 } from '@/domain/kitModel';
import { FLASH_MS, FONT, RING_MS, SQUASH_MS, TEXT_MS, squashAmp, squashScale } from './kitPadPaint';

/** 손 색(왼손, 오른손). 자세 마커와 판정 범위가 같이 쓴다 */
export const HAND_COLORS = ['#7cc4ff', '#ffa07c'] as const;

const TAU = Math.PI * 2;

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

export interface PaintSolidOpts {
  fx?: HitFx;
  now: number;
  reduced: boolean;
  /** 선택 패드: 흰 테두리 + 맥박 링 */
  target: boolean;
  /** 판정 미리보기 패드: 패드 색 굵은 테두리 */
  preview: boolean;
  /** 다른 패드를 흐리게 */
  dim: boolean;
  /** 이름 아래 키 표시. 없으면 그리지 않는다 */
  keys?: string;
}

/** 패드 한 개: 스탠드·통 옆면·윗면 타원·이름 */
export function paintSolidPad(ctx: CanvasRenderingContext2D, s: PadShape, o: PaintSolidOpts): void {
  const meta = PAD_META[s.pad];
  const color = meta.color;
  const age = o.fx ? o.now - o.fx.at : Infinity;
  const flash = o.fx ? Math.max(0, 1 - age / FLASH_MS) : 0;
  const { cx, rx } = s;
  const ry = Math.max(1, s.ry);
  const base = o.dim ? 0.35 : 1;
  // 눌림: 윗면이 살짝 내려갔다 올라온다(통·스탠드는 그대로)
  let cy = s.cy;
  if (o.fx && !o.reduced && age < SQUASH_MS) cy += (1 - squashScale(age / SQUASH_MS, squashAmp(o.fx.velocity))) * ry * 0.9;

  ctx.save();
  ctx.globalAlpha = base;
  if (s.stand > 0) {
    const foot = s.cy + s.stand;
    ctx.strokeStyle = '#586273';
    ctx.lineWidth = Math.max(2, rx * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, foot);
    ctx.moveTo(cx, s.cy + s.stand * 0.8);
    ctx.lineTo(cx - rx * 0.35, foot);
    ctx.moveTo(cx, s.cy + s.stand * 0.8);
    ctx.lineTo(cx + rx * 0.35, foot);
    ctx.stroke();
  }
  if (s.wall > 0) {
    const bottom = s.cy + s.wall;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.lineTo(cx - rx, bottom);
    ctx.ellipse(cx, bottom, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, false);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    g.addColorStop(0, color + '55');
    g.addColorStop(0.5, color + '99');
    g.addColorStop(1, color + '3a');
    ctx.fillStyle = '#12151a';
    ctx.fill();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color + 'aa';
    ctx.stroke();
  }
  // 윗면
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fillStyle = '#1a1f26';
  ctx.fill();
  ctx.fillStyle = color;
  ctx.globalAlpha = base * Math.min(1, (s.kind === 'cymbal' ? 0.42 : 0.24) + flash * 0.76);
  ctx.fill();
  ctx.globalAlpha = base;
  ctx.lineWidth = o.target || o.preview ? 4 : 2;
  ctx.strokeStyle = o.target ? '#ffffff' : o.preview ? color : color + 'cc';
  ctx.stroke();
  if (s.kind === 'cymbal') {
    // 심벌 가운데 볼록한 부분
    ctx.beginPath();
    ctx.ellipse(cx, cy - ry * 0.12, rx * 0.22, ry * 0.22, 0, 0, TAU);
    ctx.fillStyle = color + '66';
    ctx.fill();
  }
  if (o.target) {
    const pulse = 0.5 + 0.5 * Math.sin(o.now / 180);
    const grow = 8 + pulse * 6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + grow, ry + grow * (ry / rx), 0, 0, TAU);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // 이름(·키)
  const size = Math.max(11, rx * 0.3);
  const ly = cy + (s.kind === 'cymbal' ? ry * 0.45 : 0);
  ctx.fillStyle = '#f3efe6';
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.label, cx, ly - (o.keys ? size * 0.45 : 0));
  if (o.keys) {
    ctx.font = `600 ${Math.max(10, size * 0.8)}px ${FONT}`;
    ctx.fillStyle = 'rgba(243,239,230,0.7)';
    ctx.fillText(o.keys, cx, ly + size * 0.6);
  }
  ctx.restore();
}

/** 타격 링·의성어. 모든 패드 위에 그린다(움직임 줄이기면 부르지 않는다) */
export function paintSolidHitFx(ctx: CanvasRenderingContext2D, s: PadShape, fx: HitFx, now: number): void {
  const age = now - fx.at;
  const color = PAD_META[s.pad].color;
  const ry = Math.max(1, s.ry);
  if (age < RING_MS) {
    const u = age / RING_MS;
    const k = 0.9 + (1 - Math.pow(1 - u, 3));
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(s.cx, s.cy, s.rx * k, ry * k, 0, 0, TAU);
    ctx.globalAlpha = 0.9 * (1 - u);
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }
  if (age < TEXT_MS) {
    const u = age / TEXT_MS;
    const alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
    const size = Math.max(14, s.rx * 0.45 * (0.8 + (fx.velocity / 127) * 0.4));
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = color;
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fillText(PAD_META[s.pad].onomatopoeia, s.cx, s.cy - ry - s.rx * (0.3 + 0.8 * u));
    ctx.restore();
  }
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
