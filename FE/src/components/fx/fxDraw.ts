// 파티클 그리기 — 기본 도형 5종(링·점·번개·덩어리·사각 픽셀)과 발광 스프라이트 캐시.
// shadowBlur는 쓰지 않는다: 발광은 미리 그린 방사형 그라디언트 스프라이트를 drawImage한다.
import { BOLT_SUB, createSample, jagPath, sampleParticle, type FxSample } from '@/domain/hitFx/motion';
import { SHEET_DEFS, pickFrame } from '@/domain/hitFx/sheets';
import type { FxParticle } from '@/domain/hitFx/types';
import type { FxSheetStore } from './fxSheets';

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

/** '#rrggbb' → 'r,g,b'. 형식이 다르면 흰색 */
function rgbOf(hex: string): string {
  const v = /^#([0-9a-f]{6})$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
}

/**
 * 색별 발광 스프라이트(중심 불투명 → 가장자리 투명). 캔버스를 못 만들면 null.
 * bokeh는 가장자리가 살짝 밝은 흐린 원판(앞 보케)이다. soft의 모양은 기존 그대로다
 */
function glowSprite(color: string, type: 'soft' | 'bokeh' = 'soft'): CanvasImageSource | null {
  const key = type === 'bokeh' ? `bokeh${color}` : color;
  const hit = sprites.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_PX;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(SPRITE_PX / 2, SPRITE_PX / 2, 0, SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2);
  if (type === 'bokeh') {
    const c3 = rgbOf(color);
    grad.addColorStop(0, `rgba(${c3},0.42)`);
    grad.addColorStop(0.72, `rgba(${c3},0.42)`);
    grad.addColorStop(0.86, `rgba(${c3},0.85)`);
    grad.addColorStop(0.94, `rgba(${c3},0.4)`);
    grad.addColorStop(1, `rgba(${c3},0)`);
  } else {
    grad.addColorStop(0, color);
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  sprites.set(key, c);
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
      const bokeh = p.sprite === 'bokeh';
      const sp = p.glow && glow ? glowSprite(p.color, bokeh ? 'bokeh' : 'soft') : null;
      if (sp) {
        // 보케는 흐린 원판이라 점 반지름 그대로, 그 밖의 발광 점은 번짐 배율을 곱한다
        const d = Math.max(0.2, s.size) * (bokeh ? 1 : GLOW_SPREAD);
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
    case 'drop': {
      // 순간 속도 방향으로 늘어난 캡슐(꼬리는 속도 반대쪽). 길이는 속도 × streak, 크기의 6배까지
      const size = Math.max(0.2, s.size);
      const sp = Math.hypot(s.vx, s.vy);
      const len = Math.min(sp * (p.streak ?? 0.006), size * 6);
      if (p.glow && glow) {
        const halo = glowSprite(p.glowColor ?? p.color);
        if (halo) {
          const d = size * 3.2;
          ctx.globalAlpha = s.alpha * 0.45;
          ctx.drawImage(halo, s.x - d, s.y - d, d * 2, d * 2);
        }
      }
      ctx.globalAlpha = s.alpha;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = size * 1.3;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      if (sp > 1 && len > 0.3) ctx.lineTo(s.x - (s.vx / sp) * len, s.y - (s.vy / sp) * len);
      else ctx.lineTo(s.x + 0.01, s.y);
      ctx.stroke();
      if (p.core) {
        ctx.fillStyle = p.core;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 0.36, 0, TAU);
        ctx.fill();
      }
      return;
    }
    case 'bolt':
      drawBolt(ctx, p, s, scale, glow);
  }
}

/**
 * 연속 그림 한 개를 그린다. 나이로 앞·뒤 장과 섞는 비율을 구해 두 번 겹쳐 그린다(느린 재생에서도 끊기지 않는다).
 * 그림의 왼쪽 위 = (x - w/2, y - w·cy), 회전·뒤집기는 (x, y) 기준. 원본에서 가장자리 0.5px는 빼고 잘라 이웃 장이 번지지 않게 한다.
 * 그림을 아직 못 얻었으면 건너뛴다. 합성은 호출자가 더하기로 맞춰 둔다.
 */
function drawSheet(ctx: CanvasRenderingContext2D, p: FxParticle, ageMs: number, store: Pick<FxSheetStore, 'get'> | undefined) {
  if (!p.sheet || !store) return;
  const def = SHEET_DEFS[p.sheet];
  // lifeMs = 길이 ÷ 재생 속도 이므로 재생 속도는 그 비로 되돌린다
  const frame = pickFrame(def, ageMs, def.durMs / p.lifeMs);
  if (!frame) return;
  const img = store.get(p.sheet);
  if (!img) return;
  const w = p.size0;
  const fp = def.framePx;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.rot) ctx.rotate(p.rot);
  if (p.mirror) ctx.scale(-1, 1);
  for (let k = 0; k < 2; k++) {
    const n = k === 0 ? frame.a : frame.b;
    const al = p.alpha0 * (k === 0 ? 1 - frame.mix : frame.mix);
    if (n < 0 || al < 0.01) continue;
    ctx.globalAlpha = al;
    ctx.drawImage(img, (n % def.cols) * fp + 0.5, Math.floor(n / def.cols) * fp + 0.5, fp - 1, fp - 1, -w / 2, -w * def.cy, w, w);
  }
  ctx.restore();
}

/**
 * 한 프레임을 그린다. 일반 합성 파티클을 먼저, 이어서 가산(lighter) 파티클을 한 번만 전환해 그린다.
 * 가산 안에서는 연속 그림(sheet)을 먼저, 나머지를 나중에 그려 입자가 그림 위에 얹힌다.
 * sheets는 그림 보관소(없으면 sheet는 건너뛴다)
 */
export function drawFrame(ctx: CanvasRenderingContext2D, pool: readonly FxLive[], now: number, view: FxView, glow = true, sheets?: Pick<FxSheetStore, 'get'>) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.width * view.dpr, view.height * view.dpr);
  const k = view.dpr * view.scale;
  ctx.setTransform(k, 0, 0, k, view.offsetX * view.dpr, view.offsetY * view.dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let switched = false;
  // 0 = 일반 합성, 1 = 가산의 sheet, 2 = 가산의 나머지
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i] as FxLive;
      const isSheet = l.p.kind === 'sheet';
      if (pass === 0 ? l.additive : !l.additive || isSheet !== (pass === 1)) continue;
      const age = now - l.t0 - l.p.delayMs;
      if (pass === 1) {
        if (age < 0 || age >= l.p.lifeMs) continue;
      } else if (!sampleParticle(l.p, age, sample)) continue;
      if (pass > 0 && !switched) {
        ctx.globalCompositeOperation = 'lighter';
        switched = true;
      }
      if (pass === 1) drawSheet(ctx, l.p, age, sheets);
      else drawOne(ctx, l.p, sample, view.scale, glow);
    }
  }
  if (switched) ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
