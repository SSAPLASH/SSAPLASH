// 테스트 전용 배치 고정값. 넓게/좁게 배치 프리셋은 제품에서 없어졌으므로(PLAY-004 U9) "기본과 다른 배치"가 필요한 테스트만 쓴다.
import { DEFAULT_KIT_LAYOUT, type KitLayout } from '@/domain/kit/kitLayout';
import type { PadId } from '@/domain/kit/pads';

/** 화면 정중앙 기준으로 패드 위치만 배율 조정. 위치는 0.08~0.92로 자른다 */
export function scaleLayout(base: KitLayout, factor: number): KitLayout {
  const clamp = (v: number) => Math.min(0.92, Math.max(0.08, v));
  const out = {} as KitLayout;
  for (const pad of Object.keys(base) as PadId[]) {
    const p = base[pad];
    out[pad] = { x: clamp(0.5 + (p.x - 0.5) * factor), y: clamp(0.5 + (p.y - 0.5) * factor), r: p.r };
  }
  return out;
}

export const WIDE_LAYOUT: KitLayout = scaleLayout(DEFAULT_KIT_LAYOUT, 1.18);
export const TIGHT_LAYOUT: KitLayout = scaleLayout(DEFAULT_KIT_LAYOUT, 0.84);
