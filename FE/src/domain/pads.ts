// 패드 정의 — 공통 명세서 5장·9-2 enum 표기를 그대로 따른다.
export type PadId =
  | 'HIHAT'
  | 'SNARE'
  | 'HI_TOM'
  | 'FLOOR_TOM'
  | 'CRASH'
  | 'RIDE'
  | 'KICK';

export interface PadMeta {
  id: PadId;
  label: string;
  short: string;
  /** 화면·연출용 색 */
  color: string;
  /** 스틱으로 치는 패드인지 (KICK은 1단계에서 키보드/페달) */
  stick: boolean;
}

export const PAD_META: Record<PadId, PadMeta> = {
  CRASH: { id: 'CRASH', label: '크래시', short: 'CR', color: '#F0C96B', stick: true },
  HIHAT: { id: 'HIHAT', label: '하이햇', short: 'HH', color: '#E6B85C', stick: true },
  SNARE: { id: 'SNARE', label: '스네어', short: 'SN', color: '#F2E8D5', stick: true },
  HI_TOM: { id: 'HI_TOM', label: '하이탐', short: 'HT', color: '#E0875A', stick: true },
  FLOOR_TOM: { id: 'FLOOR_TOM', label: '플로어탐', short: 'FT', color: '#C5563F', stick: true },
  RIDE: { id: 'RIDE', label: '라이드', short: 'RD', color: '#5FB8AE', stick: true },
  KICK: { id: 'KICK', label: '킥', short: 'KK', color: '#8C7BFF', stick: false },
};

/** 노트 레인 순서 (왼쪽 → 오른쪽). 실제 드럼 배치와 비슷하게 둔다. */
export const LANE_ORDER: PadId[] = ['CRASH', 'HIHAT', 'SNARE', 'HI_TOM', 'FLOOR_TOM', 'RIDE', 'KICK'];

export const ALL_PADS: PadId[] = LANE_ORDER;

/** 스틱 캘리브레이션 대상 패드 (KICK 제외) */
export const STICK_PADS: PadId[] = LANE_ORDER.filter((p) => PAD_META[p].stick);

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

export const DEFAULT_KIT_LAYOUT: KitLayout = {
  CRASH: { x: 0.2, y: 0.22, r: 0.1 },
  HIHAT: { x: 0.24, y: 0.52, r: 0.085 },
  SNARE: { x: 0.42, y: 0.68, r: 0.095 },
  HI_TOM: { x: 0.5, y: 0.36, r: 0.08 },
  FLOOR_TOM: { x: 0.72, y: 0.66, r: 0.1 },
  RIDE: { x: 0.8, y: 0.26, r: 0.11 },
  KICK: { x: 0.58, y: 0.9, r: 0.065 },
};
