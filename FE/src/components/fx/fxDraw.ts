// 파티클 그리기 — 기본 도형 5종(링·점·번개·덩어리·사각 픽셀)과 발광 스프라이트 캐시.
// shadowBlur는 쓰지 않는다: 발광은 미리 그린 방사형 그라디언트 스프라이트를 drawImage한다.
import { BOLT_SUB, createSample, jagPath, sampleParticle, type FxSample } from '@/domain/hitFx/motion';
import type { FxParticle } from '@/domain/hitFx/types';

/** 풀에 들어 있는 파티클: 생성 시각과 합성 방식을 함께 든다 */
export interface FxLive {
  p: FxParticle;
  /** 생성 시각(ms, 엔진 시계) */
  t0: number;
  additive: boolean;
}

/** 킷 좌표 → 캔버스 변환. 크기는 CSS px, 그릴 때 dpr를 곱한다 */
export interface FxView {
  /** 캔버스 CSS 크기 */
  width: number;
  height: number;
  /** 킷 좌표 1 = CSS px scale */
  scale: number;
  /** 킷 원점의 캔버스 안 위치(CSS px) — bleed 여백 */
  offsetX: number;
  offsetY: number;
  dpr: number;
}

const SPRITE_PX = 64;
const sprites = new Map<string, CanvasImageSource>();

/** 색별 발광 스프라이트(중심 불투명 → 가장자리 투명). 캔버스를 못 만들면 null */
function glowSprite(color: string): CanvasImageSource | null {
  const hit = sprites.get(color);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_PX;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(SPRITE_PX / 2, SPRITE_PX / 2, 0, SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.3, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  sprites.set(color, c);
  return c;
}

/** 스프라이트 캐시 비우기(테스트용) */
export function clearGlowSprites() {
  sprites.clear();
}

const sample: FxSample = createSample();
const scratch = new Float64Array((BOLT_SUB * 8 + 2) * 2 * 2);
const TAU = Math.PI * 2;
/** 발광 스프라이트가 점 반지름의 몇 배로 퍼지는지 */
const GLOW_SPREAD = 2.4;

function drawBolt(ctx: CanvasRenderingContext2D, p: FxParticle, s: FxSample, scale: number, glow: boolean) {
  if (!p.points) return;
  const n = jagPath(p.points, p.seed ?? 0, s.step, p.jag ?? 0, scratch);
  if (n < 2) return;
  ctx.beginPath();
  ctx.moveTo(scratch[0] as number, scratch[1] as number);
  for (let i = 1; i < n; i++) ctx.lineTo(scratch[i * 2] as number, scratch[i * 2 + 1] as number);
  const w = Math.max(0.1, s.width) / scale;
  if (p.glow && glow) {
    // 넓고 옅은 테두리(발광) 뒤에 얇은 중심선
    ctx.globalAlpha = s.alpha * 0.35;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = w * 3.4;
    ctx.stroke();
  }
  ctx.globalAlpha = s.alpha;
  ctx.strokeStyle = p.core ?? p.color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function drawOne(ctx: CanvasRenderingContext2D, p: FxParticle, s: FxSample, scale: number, glow: boolean) {
  if (s.alpha <= 0.003) return;
  switch (p.kind) {
    case 'ring': {
      if (s.width <= 0.05) return;
      ctx.globalAlpha = s.alpha;
      ctx.strokeStyle = p.color;
      // 선 두께는 화면 px로 유지한다(옛 SVG의 non-scaling-stroke)
      ctx.lineWidth = s.width / scale;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, p.rx * s.size, p.ry * s.size, 0, 0, TAU);
      ctx.stroke();
      return;
    }
    case 'dot': {
      ctx.globalAlpha = s.alpha;
      const sp = p.glow && glow ? glowSprite(p.color) : null;
      if (sp) {
        const d = s.size * GLOW_SPREAD;
        ctx.drawImage(sp, s.x - d, s.y - d, d * 2, d * 2);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(0.1, s.size), 0, TAU);
        ctx.fill();
      }
      return;
    }
    case 'blob': {
      ctx.globalAlpha = s.alpha;
      const rx = p.rx * s.size;
      const ry = p.ry * s.size;
      const sp = p.glow && glow ? glowSprite(p.color) : null;
      if (sp) {
        ctx.drawImage(sp, s.x - rx * 1.5, s.y - ry * 1.5, rx * 3, ry * 3);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, rx, ry, 0, 0, TAU);
        ctx.fill();
      }
      return;
    }
    case 'pixel': {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = p.color;
      const h = s.size / 2;
      ctx.fillRect(s.x - h, s.y - h, s.size, s.size);
      return;
    }
    case 'shard': {
      // 회전 삼각형(깨짐 파편). 꼭짓점 3개를 직접 계산한다 — save/restore·transform 없이
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = p.color;
      const r = Math.max(0.1, s.size);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        // 외접 반지름 r에 120도 간격, 한 꼭짓점을 길게 늘여 뾰족한 파편처럼 보이게(1.3배)
        const a = s.rot + (i * TAU) / 3;
        const k = i === 0 ? 1.3 : 0.8;
        const px = s.x + Math.cos(a) * r * k;
        const py = s.y + Math.sin(a) * r * k;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'bolt':
      drawBolt(ctx, p, s, scale, glow);
  }
}

/** 한 프레임을 그린다. 일반 합성 파티클을 먼저, 가산(lighter) 파티클을 묶어서 한 번만 전환해 그린다 */
export function drawFrame(ctx: CanvasRenderingContext2D, pool: readonly FxLive[], now: number, view: FxView, glow = true) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.width * view.dpr, view.height * view.dpr);
  const k = view.dpr * view.scale;
  ctx.setTransform(k, 0, 0, k, view.offsetX * view.dpr, view.offsetY * view.dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    const additive = pass === 1;
    let switched = false;
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i] as FxLive;
      if (l.additive !== additive) continue;
      if (!sampleParticle(l.p, now - l.t0 - l.p.delayMs, sample)) continue;
      if (additive && !switched) {
        ctx.globalCompositeOperation = 'lighter';
        switched = true;
      }
      drawOne(ctx, l.p, sample, view.scale, glow);
    }
    if (switched) ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}
