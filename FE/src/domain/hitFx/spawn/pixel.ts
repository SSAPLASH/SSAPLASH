// pixel 테마 — 드럼: 사각 블록 파편, 심벌: 작은 블록 별(8방향), 킥: 큰 블록 고리. 12fps 계단 움직임(ease step12), 일반 합성.
import type { PadShape } from '@/domain/kit/drumKit';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle } from '../types';
import { particle } from './util';

export const PIXEL_PALETTE: FxPalette = { main: '#ff5fa2', sub: '#ffe14d', glow: '#ff5fa2' };
const LIFE_MS = 420;

function block(x: number, y: number, vx: number, vy: number, size: number, alpha: number, color: string, extra: Partial<FxParticle> = {}): FxParticle {
  return particle({
    kind: 'pixel',
    x,
    y,
    vx,
    vy,
    size0: size,
    size1: size * 0.5,
    alpha0: alpha,
    alpha1: 0.2,
    color,
    lifeMs: LIFE_MS,
    ease: 'step12',
    ...extra,
  });
}

export function spawnPixel(_event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  const out: FxParticle[] = [];
  const a = intensity.alpha;
  if (shape === 'drum') {
    // 사각 파편 8~14개: 사방으로 흩어지며 떨어진다
    const n = Math.round(10 * intensity.count);
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const speed = (110 + 160 * rand()) * geo.k * (0.7 + 0.3 * intensity.size);
      out.push(
        block(geo.cx + Math.cos(ang) * geo.rx * 0.3, geo.cy + Math.sin(ang) * geo.ry * 0.3, Math.cos(ang) * speed, Math.sin(ang) * speed - 60 * geo.k, (4 + 4 * rand()) * geo.k * intensity.size, a, i % 3 === 0 ? palette.sub : palette.main, { ay: 520 * geo.k }),
      );
    }
  } else if (shape === 'cymbal') {
    // 작은 블록 별: 8방향 × 2칸이 바깥으로 퍼진다(+자 방향은 노랑)
    const arm = Math.max(1, Math.round(2 * intensity.count));
    const r0 = rand() * 0.15;
    for (let d = 0; d < 8; d++) {
      const ang = (d * Math.PI) / 4 + r0;
      for (let j = 0; j < arm; j++) {
        const speed = (120 + 70 * j) * geo.k * (0.7 + 0.3 * intensity.size);
        out.push(block(geo.cx + Math.cos(ang) * geo.rx * 0.55, geo.cy + Math.sin(ang) * geo.ry * 0.55, Math.cos(ang) * speed, Math.sin(ang) * speed, (3 + (arm - j)) * geo.k, a, d % 2 === 0 ? palette.sub : palette.main));
      }
    }
  } else {
    // 킥: 큰 블록 고리 — 타원 둘레 12~18칸이 바깥으로 번진다
    const n = Math.min(18, Math.round(14 * intensity.count));
    const a0 = rand() * 0.4;
    for (let i = 0; i < n; i++) {
      const ang = a0 + (i * Math.PI * 2) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      out.push(block(geo.cx + c * geo.rx * 0.7, geo.cy + s * geo.ry * 0.7, c * 170 * geo.k * intensity.size, s * 170 * geo.k * intensity.size, 9 * geo.k * intensity.size, a, i % 2 ? palette.main : palette.sub, { size1: 5 * geo.k }));
    }
  }
  return out;
}
