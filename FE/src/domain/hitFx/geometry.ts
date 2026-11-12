// 패드 헤드 중심·반지름(킷 좌표). 옛 HitEffects의 geoOf를 옮겼다.
import { kitBoxFor, type DrumKitPad, type KitSkin } from '@/domain/drumKit';
import type { FxGeo } from './types';

export function fxGeoOf(p: DrumKitPad, skin: KitSkin): FxGeo {
  const s = p.w / 160;
  if (p.art) {
    // 실물: 패드별 그림의 헤드. k는 헤드 크기 기준이다(옛 그림은 헤드 가로 반지름 76에서 폭 120이 k 1 → 화면 반지름 57)
    const h = p.art.head;
    return { cx: p.left + h.cx * s, cy: p.top + h.cy * s, rx: h.rx * s, ry: h.ry * s, k: (h.rx * s) / 57, floor: kitBoxFor(skin).h };
  }
  // 전자·네온은 정사각 원판: 중심 (80,80), 몸통 반지름 72
  return { cx: p.left + 80 * s, cy: p.top + 80 * s, rx: 72 * s, ry: 72 * s, k: p.w / 120 };
}
