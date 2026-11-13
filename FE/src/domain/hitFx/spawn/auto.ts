// auto 테마 — 옛 HitEffects(충격파 링 450ms + 심벌 스파크 8개 350ms)를 캔버스 파티클로 재현한다.
import type { PadShape } from '@/domain/kit/drumKit';
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle } from '../types';
import { particle } from './util';

const SPARK_COUNT = 8;
const RING_MS = 450;
const SPARK_MS = 350;

export function spawnAuto(_event: FxEvent, geo: FxGeo, shape: PadShape, intensity: FxIntensity, rand: () => number, palette: FxPalette): FxParticle[] {
  // 세기 0~1(옛 코드의 velocity/127 자리)
  const n = (intensity.size - 0.6) / 0.8;
  const out: FxParticle[] = [
    particle({
      kind: 'ring',
      x: geo.cx,
      y: geo.cy,
      rx: geo.rx,
      ry: geo.ry,
      size0: 0.9,
      size1: 1.35 + 0.35 * n,
      alpha0: 0.5 + 0.4 * n,
      alpha1: 0,
      w0: 3,
      w1: 0,
      color: palette.main,
      lifeMs: RING_MS,
    }),
  ];
  if (shape === 'cymbal') {
    for (let i = 0; i < SPARK_COUNT; i++) {
      // 균등 각도에 ±10도 지터, 거리 18~28 × 패드 폭 배율. 헤드 가장자리 근처에서 바깥으로 퍼진다
      const rad = (((i * 360) / SPARK_COUNT + (rand() - 0.5) * 20) * Math.PI) / 180;
      const dist = (18 + 10 * rand()) * geo.k;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const life = SPARK_MS / 1000;
      // 속도 2D/L, 가속 -v/L → 수명 끝에 정확히 D만큼 이동(ease-out)
      const vx = (2 * dist * c) / life;
      const vy = (2 * dist * s) / life;
      out.push(
        particle({
          kind: 'dot',
          x: geo.cx + c * geo.rx * 0.6,
          y: geo.cy + s * geo.ry * 0.6,
          vx,
          vy,
          ax: -vx / life,
          ay: -vy / life,
          size0: 2,
          size1: 2,
          alpha0: 1,
          alpha1: 0,
          color: palette.sub,
          lifeMs: SPARK_MS,
          ease: 'linear',
        }),
      );
    }
  }
  return out;
}
