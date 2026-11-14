// fire 테마 — 한 타 = 연속 그림 1회 재생(헤드 면이 번쩍 붙고 불길이 혀처럼 갈라져 솟다 밑동부터 꺼지며 떠오름) + 입자 몇 개.
// 입자는 헤드가 달아오르는 빛 2개와 그림 위로 올라가는 불티만 맡는다. 그림은 배열 맨 앞. 합성은 모두 더하기.
import type { PadShape } from '@/domain/kit/drumKit';
import { pickSheet } from '../sheets';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle, FxSheetId } from '../types';
import { spawnFireLite } from './fireLite';
import { SHEET_BASE_SCALE, isCompact, sheetParticle, sizeGain } from './sheetFx';
import { particle } from './util';

const SHEETS: readonly FxSheetId[] = ['fire-side-a', 'fire-side-b', 'fire-cymbal', 'fire-front'];
const TAU = Math.PI * 2;
/** 이 테마의 수명 상한(불티 포함, 시작 지연 포함) */
const MAX_LIFE = 640;

/** 헤드 달아오름: 헤드 타원 위의 발광 덩어리 */
function heat(geo: FxGeo, color: string, alpha: number, size0: number, size1: number, lifeMs: number, ease: 'expo' | 'out'): FxParticle {
  return particle({ kind: 'blob', x: geo.cx, y: geo.cy, rx: geo.rx, ry: geo.ry, size0, size1, alpha0: alpha, alpha1: 0, color, glow: true, lifeMs, ease, blend: 'add' });
}

export function spawnFire(event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  // 페달은 그림 없이 지금의 작은 입자 이펙트
  if (shape === 'pedal') return spawnFireLite(event, geo, shape, intensity, rand, palette);
  const { cx, cy, rx, ry, k } = geo;
  const out: FxParticle[] = [];

  const id = pickSheet(SHEETS, shape, rx, ry, rand);
  if (id) out.push(sheetParticle(geo, id, sizeGain(intensity), isCompact(event.mode), rand, 0.75, palette.sub));

  // 헤드 달아오름: 밝은 노랑이 짧게(0~120ms), 주황이 길게(0~420ms) 남는다
  out.push(heat(geo, palette.sub, 0.3 * intensity.alpha, 0.9, 1.05, 120, 'expo'));
  out.push(heat(geo, palette.main, 0.16 * intensity.alpha, 1, 1.1, 420, 'out'));

  // 불티: 그림 위로 올라가는 작은 발광 점. 위로 가속한다. 킥은 덜 올라간다
  const up = shape === 'kick' ? 0.5 : 1;
  const embers = Math.round(5 * intensity.count);
  for (let i = 0; i < embers; i++) {
    const a = rand() * TAU;
    const rr = Math.sqrt(rand()) * 0.8;
    const delay = 40 + Math.round(120 * rand());
    out.push(
      particle({
        kind: 'dot',
        x: cx + Math.cos(a) * rx * rr,
        y: cy + Math.sin(a) * ry * rr,
        vx: (rand() - 0.5) * 150 * k,
        vy: -(240 + 260 * rand()) * k * up * SHEET_BASE_SCALE,
        ay: -90 * k,
        drag: 3.2,
        size0: 1.2 + 0.7 * rand(),
        size1: 0.4,
        alpha0: 0.95,
        alpha1: 0,
        hold: 0.45,
        color: i % 2 ? palette.sub : palette.main,
        glow: true,
        delayMs: delay,
        // 380~640ms, 단 시작 지연을 더해서도 수명 상한을 넘지 않게 한다
        lifeMs: 380 + Math.round(rand() * (MAX_LIFE - delay - 380)),
        blend: 'add',
      }),
    );
  }
  return out;
}
