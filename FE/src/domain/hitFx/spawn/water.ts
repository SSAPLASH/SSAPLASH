// water 테마 — 한 타 = 연속 그림 1회 재생(막 → 가닥 → 방울) + 입자 몇 개.
// 그림이 덩어리를 맡고, 입자는 헤드 반짝임·잔물결·그림 밖으로 날아가는 방울·앞 보케(심벌은 보케 없음)만 맡는다.
// 그림은 파티클 배열의 맨 앞에 둔다(상한에 걸리면 뒤의 입자부터 빠진다). 그림 속 색이 구워져 있어 팔레트는 쓰지 않는다.
import type { PadShape } from '@/domain/kit/drumKit';
import { pickSheet } from '../sheets';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle, FxSheetId } from '../types';
import { SHEET_BASE_SCALE, isCompact, sheetParticle, sizeGain } from './sheetFx';
import { particle } from './util';
import { spawnWaterLite } from './waterLite';

/** 입자 색(설계 3-6: 흰빛·틴트·번짐) */
const WATER = { white: '#f2f9ff', tint: '#9fd8ff', glow: '#6fc3ff' };
const TAU = Math.PI * 2;
const SHEETS: readonly FxSheetId[] = ['water-side-a', 'water-side-b', 'water-cymbal', 'water-front'];

/** 입자 방울은 그림 속 방울과 크기를 맞추려고 작고 짧게 그린다 */
const DROP_SIZE = 0.5;
const DROP_STREAK = 0.006;
const DROP_ALPHA = 0.85;

/** 그림 밖으로 날아가는 방울(순간 속도 방향 캡슐). 그림 속 방울과 크기·밝기를 맞춘다 */
function flyingDrop(o: { x: number; y: number; vx: number; vy: number; ay: number; drag: number; size: number; alpha: number; hold: number; lifeMs: number; streak?: number }): FxParticle {
  return particle({
    kind: 'drop',
    x: o.x,
    y: o.y,
    vx: o.vx,
    vy: o.vy,
    ay: o.ay,
    drag: o.drag,
    size0: o.size * DROP_SIZE,
    size1: 0.8 * DROP_SIZE,
    alpha0: o.alpha * DROP_ALPHA,
    alpha1: 0,
    hold: o.hold,
    color: WATER.white,
    core: '#ffffff',
    glow: true,
    glowColor: WATER.glow,
    lifeMs: o.lifeMs,
    streak: o.streak ?? DROP_STREAK,
    blend: 'add',
  });
}

/** 앞 보케: 크고 흐린 원판 */
function bokeh(o: { x: number; y: number; vx: number; vy: number; ay: number; drag: number; s0: number; s1: number; alpha: number; hold: number; lifeMs: number }): FxParticle {
  return particle({
    kind: 'dot',
    x: o.x,
    y: o.y,
    vx: o.vx,
    vy: o.vy,
    ay: o.ay,
    drag: o.drag,
    size0: o.s0,
    size1: o.s1,
    alpha0: o.alpha,
    alpha1: 0,
    hold: o.hold,
    color: WATER.glow,
    glow: true,
    sprite: 'bokeh',
    lifeMs: o.lifeMs,
    blend: 'add',
  });
}

export function spawnWater(event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  // 페달은 그림 없이 지금의 작은 입자 이펙트
  if (shape === 'pedal') return spawnWaterLite(event, geo, shape, intensity, rand, palette);
  const { cx, cy, rx, ry, k } = geo;
  const I = intensity;
  const a = I.alpha;
  const compact = isCompact(event.mode);
  const g = sizeGain(I);
  const hs = (compact ? 0.6 : 1) * (0.7 + 0.3 * I.size);
  const bokehOn = event.velocity >= 80 && !compact;
  const out: FxParticle[] = [];

  const id = pickSheet(SHEETS, shape, rx, ry, rand);
  if (id) out.push(sheetParticle(geo, id, g, compact, rand, 0.7, WATER.white));

  if (shape === 'drum') {
    // 헤드 반짝임: 헤드 타원이 밝았다 꺼진다(일반 합성)
    out.push(particle({ kind: 'blob', x: cx, y: cy, rx, ry, size0: 0.9, size1: 1.02, alpha0: 0.42 * a, alpha1: 0, color: WATER.tint, lifeMs: 110, ease: 'expo', blend: 'normal' }));
    // 날아가는 방울: 시안 방울 14개 중 3개에 1개만 남긴다
    const drops = Math.ceil(Math.round(14 * I.count) / 3);
    for (let i = 0; i < drops; i++) {
      const r = Math.sqrt(rand()) * 0.86;
      const ang = rand() * TAU;
      const ox = Math.cos(ang) * r;
      const oy = Math.sin(ang) * r;
      const c = 1 - 0.45 * r;
      const u = rand();
      out.push(
        flyingDrop({
          x: cx + ox * rx,
          y: cy + oy * ry,
          vx: (ox * 170 + (rand() - 0.5) * 110) * k * SHEET_BASE_SCALE,
          vy: -(620 + 1150 * u * u) * k * hs * c * SHEET_BASE_SCALE,
          ay: 560 * k,
          drag: 11,
          size: (0.9 + 1.3 * rand()) * I.size,
          alpha: 0.95 * a,
          hold: 0.6,
          lifeMs: 420 + Math.round(219 * rand()),
        }),
      );
    }
    // 잔물결: 헤드 안에서만 퍼지는 타원 링 2겹(일반 합성)
    for (let i = 0; i < 2; i++) {
      const delay = 60 + 100 * i;
      out.push(particle({ kind: 'ring', x: cx, y: cy, rx, ry, size0: 0.3, size1: 0.95, alpha0: (0.42 - 0.12 * i) * a, alpha1: 0, w0: 1.5, w1: 0.4, color: WATER.tint, delayMs: delay, lifeMs: 640 - delay, blend: 'normal' }));
    }
    if (bokehOn) {
      for (let i = 0; i < 3; i++) {
        const s = (6 + 5 * rand()) * I.size;
        out.push(bokeh({ x: cx + (rand() - 0.5) * rx * 1.2, y: cy - ry * 0.2, vx: (rand() - 0.5) * 520 * k, vy: -(520 + 520 * rand()) * k * hs, ay: 380 * k, drag: 9, s0: s, s1: s * 1.25, alpha: 0.22 * a, hold: 0.35, lifeMs: 350 + Math.round(149 * rand()) }));
      }
    }
  } else if (shape === 'cymbal') {
    // 가장자리 반짝임 고리(일반 합성)
    out.push(particle({ kind: 'ring', x: cx, y: cy, rx, ry, size0: 1, size1: 1.03, alpha0: 0.8 * a, alpha1: 0, w0: 3.5, w1: 0, color: WATER.tint, lifeMs: 110, ease: 'expo', blend: 'normal' }));
    const drops = Math.ceil(Math.round(9 * I.count) / 3);
    for (let i = 0; i < drops; i++) {
      const ang = rand() * TAU;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const u = rand();
      const sp = (390 + 570 * u * u) * k * hs * SHEET_BASE_SCALE;
      out.push(
        flyingDrop({
          x: cx + c * rx * 0.95,
          y: cy + s * ry * 0.95,
          vx: c * sp,
          vy: s * sp * 0.4 - (195 + 255 * rand()) * k * hs * SHEET_BASE_SCALE,
          ay: 620 * k,
          drag: 9,
          size: (0.8 + 1.1 * rand()) * I.size,
          alpha: 0.95 * a,
          hold: 0.55,
          lifeMs: 380 + Math.round(219 * rand()),
        }),
      );
    }
    out.push(particle({ kind: 'ring', x: cx, y: cy, rx, ry, size0: 0.95, size1: 1.16, alpha0: 0.5 * a, alpha1: 0, w0: 1.3, w1: 0.3, color: WATER.tint, delayMs: 0, lifeMs: 380, blend: 'normal' }));
  } else {
    // 킥: 헤드 반짝임 + 방울(정면 그림)
    out.push(particle({ kind: 'blob', x: cx, y: cy, rx, ry, size0: 0.9, size1: 1.02, alpha0: 0.4 * a, alpha1: 0, color: WATER.tint, lifeMs: 110, ease: 'expo', blend: 'normal' }));
    const drops = Math.ceil(Math.round(10 * I.count) / 3);
    for (let i = 0; i < drops; i++) {
      const ang = rand() * TAU;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const r0 = 0.2 + 0.5 * rand();
      const u = rand();
      const sp = (380 + 620 * u * u) * k * hs * SHEET_BASE_SCALE;
      out.push(
        flyingDrop({
          x: cx + c * rx * r0,
          y: cy + s * ry * r0,
          vx: c * sp,
          vy: s * sp - 120 * k * SHEET_BASE_SCALE,
          ay: 520 * k,
          drag: 8,
          size: (1.2 + 0.9 * rand()) * I.size,
          alpha: 0.9 * a,
          hold: 0.5,
          lifeMs: 380 + Math.round(179 * rand()),
        }),
      );
    }
    if (bokehOn) {
      for (let i = 0; i < 3; i++) {
        const ang = rand() * TAU;
        const sp = (300 + 300 * rand()) * k;
        const s = (8 + 6 * rand()) * I.size;
        out.push(bokeh({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80 * k, ay: 300 * k, drag: 7, s0: s * 0.6, s1: s * 1.5, alpha: 0.2 * a, hold: 0.3, lifeMs: 360 + Math.round(159 * rand()) }));
      }
    }
  }
  return out;
}
