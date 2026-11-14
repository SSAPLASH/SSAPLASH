// fire 테마의 입자 전용 대체 함수(spawnLite) — 연속 그림이 준비되지 않았거나 못 불러올 때, 페달에서 쓴다.
// 드럼: 위로 솟는 불씨 + 짧은 불꽃, 심벌: 사방으로 흩어지는 불티, 킥: 아래에서 치솟는 불길. 가산 합성.
import type { PadShape } from '@/domain/kit/drumKit';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle } from '../types';
import { particle } from './util';

export const FIRE_PALETTE: FxPalette = { main: '#ff7a1a', sub: '#ffd36a', glow: '#ff5a00' };

/** 짧은 불꽃(덩어리): 위로 솟으며 줄어든다 */
function flame(x: number, y: number, rx: number, ry: number, vy: number, alpha: number, color: string, life: number, delayMs = 0): FxParticle {
  return particle({
    kind: 'blob',
    x,
    y,
    vy,
    drag: 2.2,
    rx,
    ry,
    size0: 1,
    size1: 0.25,
    alpha0: alpha,
    alpha1: 0,
    color,
    glow: true,
    lifeMs: life,
    delayMs,
  });
}

/** 불씨·불티(점): 가벼워서 위로 떠오르거나 흩어진다 */
function ember(x: number, y: number, vx: number, vy: number, size: number, alpha: number, color: string, life: number, ay = -120): FxParticle {
  return particle({
    kind: 'dot',
    x,
    y,
    vx,
    vy,
    ay,
    drag: 1.6,
    size0: size,
    size1: size * 0.3,
    alpha0: alpha,
    alpha1: 0,
    color,
    glow: true,
    lifeMs: life,
    ease: 'linear',
  });
}

export function spawnFireLite(_event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  const out: FxParticle[] = [];
  const a = intensity.alpha;
  if (shape === 'drum') {
    // 짧은 불꽃 4~7개 + 위로 솟는 불씨 6~10개
    const flames = Math.round(5 * intensity.count);
    for (let i = 0; i < flames; i++) {
      const x = geo.cx + (rand() - 0.5) * geo.rx * 1.2;
      out.push(flame(x, geo.cy - geo.ry * 0.1, geo.rx * 0.2 * intensity.size, geo.ry * 0.34 * intensity.size, -(150 + 110 * rand()) * geo.k, 0.85 * a, i % 2 ? palette.sub : palette.main, 280 + Math.round(80 * rand())));
    }
    const embers = Math.round(8 * intensity.count);
    for (let i = 0; i < embers; i++) {
      out.push(ember(geo.cx + (rand() - 0.5) * geo.rx * 1.3, geo.cy, (rand() - 0.5) * 90 * geo.k, -(120 + 190 * rand()) * geo.k * (0.7 + 0.3 * intensity.size), 2.4 * intensity.size, 0.95 * a, rand() > 0.5 ? palette.sub : palette.main, 350 + Math.round(90 * rand())));
    }
  } else if (shape === 'cymbal') {
    // 흩어지는 불티: 사방으로 퍼지며 감속, 약한 중력
    const n = Math.round(14 * intensity.count);
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const speed = (130 + 220 * rand()) * geo.k * (0.7 + 0.3 * intensity.size);
      out.push(
        ember(geo.cx + Math.cos(ang) * geo.rx * 0.6, geo.cy + Math.sin(ang) * geo.ry * 0.6, Math.cos(ang) * speed, Math.sin(ang) * speed, 1.6 + 1.2 * rand(), 0.95 * a, rand() > 0.4 ? palette.sub : palette.main, 300 + Math.round(120 * rand()), 160 * geo.k),
      );
    }
  } else {
    // 킥: 패드 아래쪽에서 치솟는 불길 5~9개(폭을 따라 늘어서 순서대로 올라온다) + 불씨 몇 개
    const base = geo.cy + geo.ry * 0.7;
    const flames = Math.round(7 * intensity.count);
    for (let i = 0; i < flames; i++) {
      const x = geo.cx + ((i + 0.5) / flames - 0.5) * geo.rx * 1.7;
      out.push(flame(x, base, geo.rx * 0.2, geo.ry * 0.5 * intensity.size, -(260 + 120 * rand()) * geo.k * (0.7 + 0.3 * intensity.size), 0.9 * a, i % 3 === 0 ? palette.sub : palette.main, 300, Math.round(rand() * 60)));
    }
    for (let i = 0; i < 4; i++) {
      out.push(ember(geo.cx + (rand() - 0.5) * geo.rx * 1.4, base, (rand() - 0.5) * 70 * geo.k, -(200 + 160 * rand()) * geo.k, 2.2, 0.9 * a, palette.sub, 380));
    }
  }
  return out;
}
