// ink 테마 — 드럼: 먹물 튐 덩어리가 번지며 사라짐, 심벌: 가는 먹선 튐, 킥: 큰 먹 자국. 일반 합성.
// 어두운 배경에서 보이도록 남색-흰 계열의 밝은 잉크색을 쓴다. 수명 상한은 600ms(D10 예외).
import type { PadShape } from '@/domain/kit/drumKit';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle } from '../types';
import { particle } from './util';

export const INK_PALETTE: FxPalette = { main: '#8aa4ff', sub: '#eef2ff', glow: '#8aa4ff' };
/** 잉크 테마의 수명 상한(ms) */
export const INK_MAX_LIFE_MS = 600;

/** 번지는 먹 덩어리: 퍼지며 크기가 커지고 서서히 옅어진다 */
function splat(x: number, y: number, r: number, grow: number, alpha: number, color: string, life: number, opts: Partial<FxParticle> = {}): FxParticle {
  return particle({
    kind: 'blob',
    x,
    y,
    rx: r,
    ry: r * 0.85,
    size0: 0.45,
    size1: grow,
    alpha0: alpha,
    alpha1: 0,
    color,
    lifeMs: life,
    ...opts,
  });
}

export function spawnInk(_event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  const out: FxParticle[] = [];
  const a = intensity.alpha;
  if (shape === 'drum') {
    // 중앙 번짐 하나 + 사방으로 튀는 작은 덩어리 4~8개(튀다가 멈추며 번진다)
    out.push(splat(geo.cx, geo.cy, geo.rx * 0.5 * intensity.size, 1.5, 0.75 * a, palette.main, 520));
    const n = Math.round(6 * intensity.count);
    for (let i = 0; i < n; i++) {
      const ang = (i * Math.PI * 2) / n + (rand() - 0.5) * 0.9;
      const speed = (150 + 130 * rand()) * geo.k * (0.7 + 0.3 * intensity.size);
      out.push(
        splat(geo.cx + Math.cos(ang) * geo.rx * 0.3, geo.cy + Math.sin(ang) * geo.ry * 0.3, (4 + 4 * rand()) * geo.k * intensity.size, 1.9, 0.9 * a, i % 3 === 0 ? palette.sub : palette.main, 480 + Math.round(120 * rand()), {
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          drag: 6,
        }),
      );
    }
  } else if (shape === 'cymbal') {
    // 가는 먹선 튐: 가장자리에서 바깥으로 뻗는 직선 8~12줄(번개선 도형, 꺾임 0)
    const n = Math.round(10 * intensity.count);
    const a0 = rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const ang = a0 + (i * Math.PI * 2) / n + (rand() - 0.5) * 0.3;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const r0 = 0.75 + 0.15 * rand();
      const r1 = r0 + (0.25 + 0.4 * rand()) * intensity.size;
      out.push(
        particle({
          kind: 'bolt',
          x: 0,
          y: 0,
          points: [geo.cx + c * geo.rx * r0, geo.cy + s * geo.ry * r0, geo.cx + c * geo.rx * r1, geo.cy + s * geo.ry * r1],
          seed: 0,
          jag: 0,
          alpha0: 0.9 * a,
          alpha1: 0,
          w0: 1.8,
          w1: 0.5,
          color: i % 2 ? palette.sub : palette.main,
          lifeMs: 420 + Math.round(120 * rand()),
        }),
      );
    }
    // 끝에 맺히는 작은 먹방울 3개
    for (let i = 0; i < 3; i++) {
      const ang = rand() * Math.PI * 2;
      out.push(splat(geo.cx + Math.cos(ang) * geo.rx * 1.1, geo.cy + Math.sin(ang) * geo.ry * 1.1, 3 * geo.k, 1.6, 0.8 * a, palette.sub, 450));
    }
  } else {
    // 킥: 큰 먹 자국 하나가 넓게 번지고, 가장자리에 작은 튐 4~6개
    out.push(splat(geo.cx, geo.cy, geo.rx * 0.8 * intensity.size, 1.35, 0.8 * a, palette.main, 600, { ry: geo.ry * 0.7 * intensity.size }));
    const n = Math.round(5 * intensity.count);
    for (let i = 0; i < n; i++) {
      const ang = (i * Math.PI * 2) / n + rand() * 0.8;
      out.push(
        splat(geo.cx + Math.cos(ang) * geo.rx * 0.8, geo.cy + Math.sin(ang) * geo.ry * 0.8, (5 + 3 * rand()) * geo.k, 1.7, 0.85 * a, palette.sub, 500, {
          vx: Math.cos(ang) * 120 * geo.k,
          vy: Math.sin(ang) * 120 * geo.k,
          drag: 5,
        }),
      );
    }
  }
  return out;
}
