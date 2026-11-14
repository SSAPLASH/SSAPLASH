// water 테마의 입자 전용 대체 함수(spawnLite) — 연속 그림이 준비되지 않았거나 못 불러올 때, 페달에서 쓴다.
// 드럼: 동심원 파문 2~3겹 + 튀었다 떨어지는 물방울(중력), 심벌: 가는 물보라, 킥: 큰 파문 + 낮은 물결. 일반 합성.
import type { PadShape } from '@/domain/kit/drumKit';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle } from '../types';
import { MAX_LIFE_MS, particle } from './util';

export const WATER_PALETTE: FxPalette = { main: '#7fd6ff', sub: '#d6f3ff', glow: '#7fd6ff' };
const GRAVITY = 1000;

function ripple(geo: FxGeo, i: number, alpha: number, color: string, opts: Partial<FxParticle> = {}): FxParticle {
  const delay = i * 70;
  return particle({
    kind: 'ring',
    x: geo.cx,
    y: geo.cy,
    rx: geo.rx,
    ry: geo.ry,
    size0: 0.7,
    size1: 1.3 + 0.15 * i,
    alpha0: alpha * (0.85 - 0.15 * i),
    alpha1: 0,
    w0: 2.5,
    w1: 0.5,
    color,
    delayMs: delay,
    lifeMs: MAX_LIFE_MS - delay,
    ...opts,
  });
}

export function spawnWaterLite(_event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  const out: FxParticle[] = [];
  const a = intensity.alpha;
  if (shape === 'drum') {
    const rings = Math.min(3, Math.max(2, Math.round(2.5 * intensity.count)));
    for (let i = 0; i < rings; i++) out.push(ripple(geo, i, a, palette.main));
    // 물방울: 위로 튀었다 중력으로 떨어진다
    const drops = Math.round(8 * intensity.count);
    for (let i = 0; i < drops; i++) {
      out.push(
        particle({
          kind: 'dot',
          x: geo.cx + (rand() - 0.5) * geo.rx * 0.8,
          y: geo.cy - geo.ry * 0.2,
          vx: (rand() - 0.5) * 220 * geo.k,
          vy: -(230 + 170 * rand()) * geo.k * (0.7 + 0.3 * intensity.size),
          ay: GRAVITY * geo.k,
          size0: 3.2 * intensity.size,
          size1: 2,
          alpha0: 0.95 * a,
          alpha1: 0.1,
          color: i % 3 === 0 ? palette.sub : palette.main,
          lifeMs: 380 + Math.round(70 * rand()),
          ease: 'linear',
        }),
      );
    }
  } else if (shape === 'cymbal') {
    // 가는 물보라: 작은 물방울이 넓게 흩어진다(감속 + 약한 중력)
    out.push(ripple(geo, 0, 0.6 * a, palette.sub, { size0: 0.95, size1: 1.25, w0: 1.2, w1: 0.3, lifeMs: 380 }));
    const n = Math.round(11 * intensity.count);
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.1;
      const speed = (150 + 190 * rand()) * geo.k * (0.7 + 0.3 * intensity.size);
      out.push(
        particle({
          kind: 'dot',
          x: geo.cx + Math.cos(ang) * geo.rx * 0.7,
          y: geo.cy + Math.sin(ang) * geo.ry * 0.7,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          ay: 420 * geo.k,
          drag: 2,
          size0: 1.7,
          size1: 0.8,
          alpha0: 0.9 * a,
          alpha1: 0,
          color: palette.sub,
          lifeMs: 330 + Math.round(90 * rand()),
        }),
      );
    }
  } else {
    // 킥: 큰 파문 하나 + 바닥을 따라 퍼지는 낮은 물결 2겹
    out.push(ripple(geo, 0, a, palette.main, { size0: 0.8, size1: 1.7, w0: 3.2 }));
    for (let i = 0; i < 2; i++) {
      const delay = i * 90;
      out.push(
        particle({
          kind: 'ring',
          x: geo.cx,
          y: geo.cy + geo.ry * 0.75,
          rx: geo.rx * 1.2,
          ry: geo.ry * 0.22,
          size0: 0.8,
          size1: 1.5 + 0.2 * i,
          alpha0: 0.7 * a,
          alpha1: 0,
          w0: 2.2,
          w1: 0.4,
          color: palette.sub,
          delayMs: delay,
          lifeMs: MAX_LIFE_MS - delay,
        }),
      );
    }
  }
  return out;
}
