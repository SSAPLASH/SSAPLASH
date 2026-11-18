// 결과 축하 파티클(설계 MODE-001-score-combo-fx 3-5). 순수 함수 — 같은 seq면 같은 파티클, 한 번에 고리 1 + 점 14.
// 판정 이펙트·테마 이펙트와 달리 이벤트·패드 위치를 거치지 않고 엔진 spawn으로 바로 들어간다. 좌표는 CSS 픽셀(카드 안).
import { createRand } from '@/domain/hitFx/rand';
import type { FxParticle } from '@/domain/hitFx/types';
import { particle } from '@/domain/hitFx/spawn/util';

/** 한 번의 폭발이 만드는 점 수. 고리 1개를 더해 15개, 3번이면 45개 */
export const CELEBRATE_DOTS = 14;
/** 점 수명 범위(ms). 시작 지연을 포함한 상한 900 이하 */
export const CELEBRATE_LIFE_MIN_MS = 700;
export const CELEBRATE_LIFE_MAX_MS = 900;
/** 폭발 발사 시각(ms): 0·150·300 */
export const CELEBRATE_DELAYS_MS: readonly number[] = [0, 150, 300];

const TAU = Math.PI * 2;
/** 아래로 떨어지는 가속(px/s²) */
const GRAVITY = 380;

/** 한 지점의 축하 폭발: 고리 1 + 점 14(두 색 교대, 중력으로 약간 떨어짐) */
export function celebrate(seq: number, x: number, y: number, colors: readonly [string, string]): FxParticle[] {
  const rand = createRand(seq);
  const out: FxParticle[] = [];
  out.push(
    particle({
      kind: 'ring',
      x,
      y,
      rx: 36,
      ry: 36,
      size0: 0.4,
      size1: 1.7,
      alpha0: 0.9,
      alpha1: 0,
      w0: 3,
      w1: 0.6,
      color: colors[0],
      lifeMs: CELEBRATE_LIFE_MIN_MS,
    }),
  );
  for (let i = 0; i < CELEBRATE_DOTS; i++) {
    const a = (i / CELEBRATE_DOTS) * TAU + (rand() - 0.5) * 0.4;
    const v = 110 + 150 * rand();
    out.push(
      particle({
        kind: 'dot',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 40,
        ay: GRAVITY,
        drag: 1.4,
        size0: 3.6,
        size1: 1.4,
        alpha0: 1,
        alpha1: 0,
        color: colors[i % 2],
        glow: true,
        lifeMs: Math.round(CELEBRATE_LIFE_MIN_MS + (CELEBRATE_LIFE_MAX_MS - CELEBRATE_LIFE_MIN_MS) * rand()),
        ease: 'linear',
      }),
    );
  }
  return out;
}
