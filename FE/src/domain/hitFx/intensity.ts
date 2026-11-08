// 세기(·판정·악보 모드) → 크기·개수·밝기 배율. 테마와 무관한 순수 함수.
import type { FxEvent, FxIntensity } from './types';

const GAMMA = 0.8;
/** 판정 배율을 곱한 뒤의 상한(1단계 범위 size 1.4·count 1.5를 넘을 수 있다) */
export const MAX_SIZE = 1.6;
export const MAX_COUNT = 1.8;
/** 악보 모드의 패드 이펙트 배율(D3: 악보는 읽는 화면이라 절제) */
export const SHEET_PAD_SCALE = 0.7;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 세기 v/127에 감마 0.8을 준 뒤 선형 보간하고, 판정 배율(3-2)·악보 배율을 곱한다.
 * 판정 배율은 Record가 아니라 분기다 — 나중에 NORMAL(size ×0.6·count ×0.5·alpha ×0.7)을 GOOD 앞에 끼우기 쉽게.
 * 모르는 판정·MISS는 GOOD 이하로 본다(MISS는 패드 이펙트를 내지 않으므로 값 자체는 쓰이지 않는다).
 */
export function fxIntensity(event: Pick<FxEvent, 'velocity'> & Partial<FxEvent>): FxIntensity {
  const v = Math.min(1, Math.max(0, (Number.isFinite(event.velocity) ? event.velocity : 0) / 127));
  const g = Math.pow(v, GAMMA);
  let size = lerp(0.6, 1.4, g);
  let count = lerp(0.5, 1.5, g);
  let alpha = lerp(0.6, 1, g);
  const j = event.judgement ?? null;
  if (j === 'PERFECT') {
    size *= 1.2;
    count *= 1.2;
    alpha = 1;
  } else if (j !== null) {
    // 새 판정(NORMAL 등)은 이 앞에 분기를 더한다
    size *= 0.8;
    count *= 0.7;
    alpha *= 0.85;
  }
  if (event.mode === 'sheet') {
    size *= SHEET_PAD_SCALE;
    count *= SHEET_PAD_SCALE;
  }
  return { size: Math.min(MAX_SIZE, size), count: Math.min(MAX_COUNT, count), alpha: Math.min(1, alpha) };
}
