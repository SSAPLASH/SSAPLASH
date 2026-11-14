// electric 테마의 입자 전용 대체 함수(spawnLite) — 연속 그림이 준비되지 않았거나 못 불러올 때, 페달에서 쓴다.
// 드럼: 중심에서 갈라지는 번개 3~5줄 + 흰 섬광, 심벌: 테두리를 도는 가지 번개, 킥: 킷 아래쪽 가로 방전.
// 번개 꺾임은 그릴 때 40ms마다 seed+시간으로 다시 계산한다(깜빡임). 가산 합성.
import type { PadShape } from '@/domain/kit/drumKit';
import { DRUM_KIT_H } from '@/domain/kit/drumKit';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle } from '../types';
import { particle } from './util';

export const ELECTRIC_PALETTE: FxPalette = { main: '#59c8ff', sub: '#d9f4ff', glow: '#8fdcff' };
const BOLT_MS = 260;
const FLASH_MS = 130;

function bolt(points: number[], seed: number, jag: number, alpha: number, width: number, life = BOLT_MS): FxParticle {
  return particle({
    kind: 'bolt',
    x: 0,
    y: 0,
    points,
    seed,
    jag,
    alpha0: alpha,
    alpha1: 0,
    w0: width,
    w1: width * 0.35,
    color: ELECTRIC_PALETTE.main,
    core: '#ffffff',
    glow: true,
    lifeMs: life,
    ease: 'linear',
  });
}

function flash(x: number, y: number, rx: number, ry: number, alpha: number): FxParticle {
  return particle({
    kind: 'blob',
    x,
    y,
    rx,
    ry,
    size0: 0.5,
    size1: 1,
    alpha0: alpha,
    alpha1: 0,
    color: '#ffffff',
    glow: true,
    lifeMs: FLASH_MS,
  });
}

export function spawnElectricLite(event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number): FxParticle[] {
  const out: FxParticle[] = [];
  const a = intensity.alpha;
  const seedBase = event.seq * 13;
  if (shape === 'drum') {
    // 번개 3~5줄: 균등 각도 + 지터, 길이는 헤드 반지름 안쪽에서 바깥으로
    const n = Math.min(5, Math.max(3, Math.round(4 * intensity.count)));
    const a0 = rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const ang = a0 + (i * Math.PI * 2) / n + (rand() - 0.5) * 0.5;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const reach = (1.05 + 0.35 * rand()) * intensity.size;
      out.push(
        bolt(
          [geo.cx + c * geo.rx * 0.15, geo.cy + s * geo.ry * 0.15, geo.cx + c * (geo.rx * reach + 10 * geo.k), geo.cy + s * (geo.ry * reach + 10 * geo.k)],
          seedBase + i,
          7 * geo.k * intensity.size,
          a,
          2.2,
        ),
      );
    }
    out.push(flash(geo.cx, geo.cy, geo.rx * 0.9, geo.ry * 0.9, 0.9 * a));
  } else if (shape === 'cymbal') {
    // 테두리를 도는 가지 번개: 타원 둘레를 따라가는 호 3개
    const n = Math.min(4, Math.max(2, Math.round(3 * intensity.count)));
    const a0 = rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const start = a0 + (i * Math.PI * 2) / n;
      const span = (0.8 + 0.5 * rand()) * intensity.size;
      const pts: number[] = [];
      const steps = 5;
      for (let j = 0; j <= steps; j++) {
        const ang = start + (span * j) / steps;
        pts.push(geo.cx + Math.cos(ang) * geo.rx * 1.02, geo.cy + Math.sin(ang) * geo.ry * 1.02);
      }
      out.push(bolt(pts, seedBase + i, 4 * geo.k, a, 2));
    }
    out.push(flash(geo.cx, geo.cy, geo.rx * 0.5, geo.ry * 0.5, 0.6 * a));
  } else {
    // 킥: 킷 아래쪽을 가로지르는 방전 2줄 + 중앙 섬광
    const y = Math.min((geo.floor ?? DRUM_KIT_H) + 4, geo.cy + geo.ry + 6 * geo.k);
    const half = geo.rx * 2.1 * intensity.size;
    out.push(bolt([geo.cx - half, y, geo.cx, y, geo.cx + half, y], seedBase, 6 * geo.k, a, 2.6));
    out.push(bolt([geo.cx - half * 0.7, y + 6, geo.cx + half * 0.7, y + 6], seedBase + 1, 5 * geo.k, 0.7 * a, 1.8));
    out.push(flash(geo.cx, geo.cy + geo.ry * 0.5, geo.rx * 0.7, geo.ry * 0.5, 0.8 * a));
  }
  return out;
}
