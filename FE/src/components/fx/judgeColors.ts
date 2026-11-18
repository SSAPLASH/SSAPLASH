// 판정 색 읽기 — 캔버스는 CSS 변수를 못 쓰므로 디자인 토큰(--perfect·--good·--miss·--text-3)을 한 번 읽어 둔다. 못 읽으면 기본값.
import { JUDGE_COLORS_FALLBACK } from '@/domain/hitFx/judgeFx';
import type { JudgeColors } from '@/domain/hitFx/types';

export function readJudgeColors(el: Element = document.documentElement): JudgeColors {
  const s = getComputedStyle(el);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    perfect: v('--perfect', JUDGE_COLORS_FALLBACK.perfect),
    good: v('--good', JUDGE_COLORS_FALLBACK.good),
    miss: v('--miss', JUDGE_COLORS_FALLBACK.miss),
    stray: v('--text-2', JUDGE_COLORS_FALLBACK.stray),
  };
}

/** 판정 팝업·콤보·축하가 쓰는 네온 색(--fx-*). 설계 MODE-001-score-combo-fx U1 ① — 파티클·고리는 readJudgeColors 그대로 */
export interface FxNeonColors {
  perfect: string;
  good: string;
  miss: string;
  combo: string;
  brand: string;
}

export const FX_NEON_FALLBACK: FxNeonColors = { perfect: '#3de8ff', good: '#3df5a0', miss: '#ff4d6d', combo: '#ffd23d', brand: '#35a3d4' };

export function readFxColors(el: Element = document.documentElement): FxNeonColors {
  const s = getComputedStyle(el);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    perfect: v('--fx-perfect', FX_NEON_FALLBACK.perfect),
    good: v('--fx-good', FX_NEON_FALLBACK.good),
    miss: v('--fx-miss', FX_NEON_FALLBACK.miss),
    combo: v('--fx-combo', FX_NEON_FALLBACK.combo),
    brand: v('--brand', FX_NEON_FALLBACK.brand),
  };
}
