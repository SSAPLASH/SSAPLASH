// 가상 키트 배치. 좌표는 0~1 정규화(화면 비율 무관). 순수 데이터·함수라 단위 테스트 대상.
import type { PadId } from './pads';

/**
 * 가상 키트 기본 배치. 좌표는 0~1 정규화(화면 비율 무관).
 * 연주자 시점: 위쪽이 멀고(심벌), 아래쪽이 가깝다(스네어·킥).
 */
export interface PadPlacement {
  x: number;
  y: number;
  /** 반지름 (정규화 단위, 가로 기준) */
  r: number;
}

export type KitLayout = Record<PadId, PadPlacement>;

/** 기본 배치 */
const BASIC_LAYOUT: KitLayout = {
  CRASH: { x: 0.2, y: 0.22, r: 0.1 },
  HIHAT: { x: 0.24, y: 0.52, r: 0.085 },
  SNARE: { x: 0.42, y: 0.68, r: 0.095 },
  HI_TOM: { x: 0.5, y: 0.36, r: 0.08 },
  FLOOR_TOM: { x: 0.72, y: 0.66, r: 0.1 },
  RIDE: { x: 0.8, y: 0.26, r: 0.11 },
  KICK: { x: 0.58, y: 0.9, r: 0.065 },
};

/** 레이아웃 중심(화면 정중앙)을 기준으로 패드 위치만 배율 조정한다. 반지름은 그대로, 위치는 0.08~0.92로 자른다 */
function scaleLayout(base: KitLayout, factor: number): KitLayout {
  const clamp = (v: number) => Math.min(0.92, Math.max(0.08, v));
  const out = {} as KitLayout;
  for (const pad of Object.keys(base) as PadId[]) {
    const p = base[pad];
    out[pad] = { x: clamp(0.5 + (p.x - 0.5) * factor), y: clamp(0.5 + (p.y - 0.5) * factor), r: p.r };
  }
  return out;
}

export type KitLayoutPresetId = 'basic' | 'wide' | 'tight';

export const KIT_LAYOUT_PRESET_LABELS: Record<KitLayoutPresetId, string> = {
  basic: '기본',
  wide: '넓게',
  tight: '좁게',
};

/** 배치 프리셋 3종. 넓게·좁게는 기본에서 파생한다 */
export const KIT_LAYOUT_PRESETS: Record<KitLayoutPresetId, KitLayout> = {
  basic: BASIC_LAYOUT,
  wide: scaleLayout(BASIC_LAYOUT, 1.18),
  tight: scaleLayout(BASIC_LAYOUT, 0.84),
};

/** 기존 이름 유지: basic의 별칭 */
export const DEFAULT_KIT_LAYOUT: KitLayout = KIT_LAYOUT_PRESETS.basic;
