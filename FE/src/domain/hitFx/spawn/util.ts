// 생성 함수 공용 도우미 — 파티클 기본값, 모션 줄이기용 덩어리.
import type { FxEvent, FxGeo, FxIntensity, FxPalette, FxParticle } from '../types';
import type { PadShape } from '@/domain/kit/drumKit';

/** 한 타격이 만들 수 있는 파티클 상한(D10) */
export const MAX_SPAWN = 24;
/** 테마 수명 상한 기본값(시작 지연 포함, ms) */
export const MAX_LIFE_MS = 450;

/** 필수 필드만 받고 나머지는 0·기본으로 채운다 */
export function particle(p: Pick<FxParticle, 'kind' | 'x' | 'y' | 'color' | 'lifeMs'> & Partial<FxParticle>): FxParticle {
  return {
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    drag: 0,
    size0: 1,
    size1: 1,
    rx: 0,
    ry: 0,
    alpha0: 1,
    alpha1: 0,
    w0: 0,
    w1: 0,
    glow: false,
    delayMs: 0,
    ease: 'out',
    ...p,
  };
}

/** 모션 줄이기용(공용): 움직임 없이 패드 위에서 밝기만 잠깐 바뀌는 덩어리 1개 */
export function spawnReduced(_event: FxEvent, geo: FxGeo, _shape: PadShape, intensity: FxIntensity, _rand: () => number, palette: FxPalette): FxParticle[] {
  return [
    particle({
      kind: 'blob',
      x: geo.cx,
      y: geo.cy,
      rx: geo.rx,
      ry: geo.ry,
      size0: 0.9,
      size1: 0.9,
      alpha0: 0.35 * intensity.alpha,
      alpha1: 0,
      color: palette.main,
      lifeMs: 160,
      ease: 'linear',
    }),
  ];
}
