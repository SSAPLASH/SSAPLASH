// 연속 그림(sheet) 파티클 공용 도우미 — 물·불·번개가 같은 규칙으로 그림 크기·밝기·뒤집기·기울기를 정한다.
import { SHEET_DEFS } from '../sheets';
import type { FxGeo, FxIntensity, FxParticle, FxSheetId } from '../types';
import { particle } from './util';

/** 그림 크기의 기본 배율(시안 첫 판의 0.76배) */
export const SHEET_BASE_SCALE = 0.76;
/** 게임·악보 모드: 그림 크기 ×0.72, 재생 ×1.3 */
export const COMPACT_SCALE = 0.72;
export const COMPACT_RATE = 1.3;

/** 게임·악보 모드인가(그림을 줄이고 빠르게 재생, 앞 보케 없음) */
export function isCompact(mode: string): boolean {
  return mode === 'game' || mode === 'sheet';
}

/** 세기 배율 → g(0~1). g = (size - 0.6) ÷ 0.8, 판정 배율이 곱해져 범위를 넘으면 자른다 */
export function sizeGain(intensity: FxIntensity): number {
  return Math.min(1, Math.max(0, (intensity.size - 0.6) / 0.8));
}

/**
 * 그림 재생 파티클 한 개. 난수는 mirror → rot → 크기 순으로 3번 쓴다.
 * 크기 배율 = 0.76 × (0.74 + 0.34g) × (0.95 + 0.1·rand) [× 0.72], 밝기 = alphaBase + (1 - alphaBase)·g, 재생 길이 = 묶음 길이 ÷ 재생 속도
 */
export function sheetParticle(geo: FxGeo, id: FxSheetId, g: number, compact: boolean, rand: () => number, alphaBase: number, color: string): FxParticle {
  const def = SHEET_DEFS[id];
  const mirror = rand() < 0.5;
  const rot = (rand() - 0.5) * 0.08;
  const scale = SHEET_BASE_SCALE * (0.74 + 0.34 * g) * (0.95 + 0.1 * rand()) * (compact ? COMPACT_SCALE : 1);
  const size = def.span * geo.rx * scale;
  const alpha = alphaBase + (1 - alphaBase) * g;
  return particle({
    kind: 'sheet',
    sheet: id,
    x: geo.cx,
    y: geo.cy,
    size0: size,
    size1: size,
    alpha0: alpha,
    alpha1: alpha,
    rot,
    mirror,
    color,
    lifeMs: def.durMs / (compact ? COMPACT_RATE : 1),
    ease: 'linear',
    blend: 'add',
  });
}
