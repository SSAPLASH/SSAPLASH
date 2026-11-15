// electric 테마 — 한 타 = 연속 그림 1회 재생(스틱 자리에서 방전이 헤드 면을 타고 가장자리로 달리며 세 번 깜빡임) + 입자 몇 개.
// 입자는 첫 방전(0ms)·둘째 방전(85ms)에 맞춘 흰 섬광 2개와 가장자리에서 튀는 짧은 불꽃만 맡는다(심벌은 더 많이, 더 멀리). 그림은 배열 맨 앞. 합성은 모두 더하기.
import type { PadShape } from '@/domain/kit/drumKit';
import { pickSheet } from '../sheets';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle, FxSheetId } from '../types';
import { spawnElectricLite } from './electricLite';
import { SHEET_BASE_SCALE, isCompact, sheetParticle, sizeGain } from './sheetFx';
import { particle } from './util';

const SHEETS: readonly FxSheetId[] = ['bolt-side-a', 'bolt-side-b', 'bolt-cymbal', 'bolt-front'];
const TAU = Math.PI * 2;
/** 둘째 방전 시각(ms) */
const SECOND_MS = 85;

/** 흰 섬광: 헤드 타원 위의 발광 덩어리 */
function flash(geo: FxGeo, color: string, alpha: number, size0: number, size1: number, delayMs: number, lifeMs: number): FxParticle {
  return particle({ kind: 'blob', x: geo.cx, y: geo.cy, rx: geo.rx, ry: geo.ry, size0, size1, alpha0: alpha, alpha1: 0, color, glow: true, delayMs, lifeMs, ease: 'expo', blend: 'add' });
}

export function spawnElectric(event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  // 페달은 그림 없이 지금의 작은 입자 이펙트
  if (shape === 'pedal') return spawnElectricLite(event, geo, shape, intensity, rand);
  const { cx, cy, rx, ry, k } = geo;
  const out: FxParticle[] = [];

  const id = pickSheet(SHEETS, shape, rx, ry, rand);
  if (id) out.push(sheetParticle(geo, id, sizeGain(intensity), isCompact(event.mode), rand, 0.8, palette.sub));

  // 흰 섬광: 첫 방전(0~90ms)과 둘째 방전(85~205ms)에 맞춰 헤드가 번쩍인다
  out.push(flash(geo, palette.sub, 0.42 * intensity.alpha, 0.85, 1.08, 0, 90));
  out.push(flash(geo, palette.main, 0.14 * intensity.alpha, 1, 1.1, SECOND_MS, 120));

  // 가장자리 불꽃: 가장자리에서 튀는 짧은 drop. 절반(홀수 번째)은 둘째 방전에 맞춘다
  const cym = shape === 'cymbal';
  const hs = (isCompact(event.mode) ? 0.6 : 1) * (0.7 + 0.3 * intensity.size);
  const sparks = cym ? Math.min(9, Math.round(8 * intensity.count)) : Math.round(5 * intensity.count);
  for (let i = 0; i < sparks; i++) {
    const a = (i / sparks) * TAU + (rand() - 0.5) * 0.9;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let sp: number;
    let vy: number;
    if (cym) {
      const u = rand();
      sp = (420 + 520 * u * u) * k * hs * SHEET_BASE_SCALE;
      vy = s * sp * 0.45 - (160 + 200 * rand()) * k * hs;
    } else {
      sp = (300 + 320 * rand()) * k * SHEET_BASE_SCALE;
      vy = s * sp * 0.55 - 120 * k;
    }
    out.push(
      particle({
        kind: 'drop',
        x: cx + c * rx * 0.95,
        y: cy + s * ry * 0.95,
        vx: c * sp,
        vy,
        ay: 500 * k,
        drag: 7,
        size0: 0.9 * intensity.size,
        size1: 0.4,
        alpha0: 0.95,
        alpha1: 0,
        hold: 0.3,
        color: '#ffffff',
        glow: true,
        glowColor: palette.main,
        delayMs: i % 2 ? SECOND_MS : 0,
        // 심벌 180~275ms: 둘째 방전 지연(85ms)을 더해도 수명 상한(360ms) 안이다
        lifeMs: cym ? 180 + Math.round(95 * rand()) : 140 + Math.round(100 * rand()),
        streak: 0.012,
        blend: 'add',
      }),
    );
  }
  return out;
}
