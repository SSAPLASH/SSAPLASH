// 세기(·판정·콤보) → 크기·개수·밝기 배율. 테마와 무관한 순수 함수.
import type { FxEvent, FxIntensity } from './types';

const GAMMA = 0.8;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 1단계 규칙: 세기 v/127에 감마 0.8을 준 뒤 선형 보간. 판정·콤보 배율은 2·3단계에서 더한다(null이면 1) */
export function fxIntensity(event: Pick<FxEvent, 'velocity'> & Partial<FxEvent>): FxIntensity {
  const v = Math.min(1, Math.max(0, (Number.isFinite(event.velocity) ? event.velocity : 0) / 127));
  const g = Math.pow(v, GAMMA);
  return { size: lerp(0.6, 1.4, g), count: lerp(0.5, 1.5, g), alpha: lerp(0.6, 1, g) };
}
