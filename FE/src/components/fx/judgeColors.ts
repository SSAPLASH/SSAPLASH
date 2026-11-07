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
