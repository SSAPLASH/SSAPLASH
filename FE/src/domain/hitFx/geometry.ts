// 패드 헤드 중심·반지름(킷 좌표 760×300). 옛 HitEffects의 geoOf를 옮겼다.
import type { DrumKitPad, KitSkin, PadShape } from '@/domain/drumKit';
import type { FxGeo } from './types';

/** 실물 스킨 링 기하(원본 160 기준). Pad.tsx의 RING 중심과 헤드 반지름에 맞춘다 */
const ACOUSTIC_HEAD: Record<PadShape, { cy: number; rx: number; ry: number }> = {
  drum: { cy: 72, rx: 76, ry: 44 },
  cymbal: { cy: 70, rx: 79, ry: 39 },
  kick: { cy: 85, rx: 76, ry: 76 },
};

export function fxGeoOf(p: DrumKitPad, skin: KitSkin): FxGeo {
  const s = p.w / 160;
  if (skin === 'acoustic') {
    const g = ACOUSTIC_HEAD[p.shape];
    return { cx: p.left + 80 * s, cy: p.top + g.cy * s, rx: g.rx * s, ry: g.ry * s, k: p.w / 120 };
  }
  // 전자·네온은 정사각 원판: 중심 (80,80), 몸통 반지름 72
  return { cx: p.left + 80 * s, cy: p.top + 80 * s, rx: 72 * s, ry: 72 * s, k: p.w / 120 };
}
