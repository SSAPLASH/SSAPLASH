// 패드 정의 — 공통 명세서 5장·9-2 enum 표기를 그대로 따른다.
// 배치 타입은 domain/kitLayout로 옮겼다. 기존 import 경로 호환용 재export
export type { KitLayout, PadPlacement } from './kitLayout';

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
  /** 타격 이펙트에 띄우는 의성어 */
  onomatopoeia: string;
}

export const PAD_META: Record<PadId, PadMeta> = {
  CRASH: { id: 'CRASH', label: '크래시', short: 'CR', color: '#F0C96B', stick: true, onomatopoeia: '챙!' },
  HIHAT: { id: 'HIHAT', label: '하이햇', short: 'HH', color: '#E6B85C', stick: true, onomatopoeia: '칫!' },
  SNARE: { id: 'SNARE', label: '스네어', short: 'SN', color: '#F2E8D5', stick: true, onomatopoeia: '탁!' },
  HI_TOM: { id: 'HI_TOM', label: '하이탐', short: 'HT', color: '#E0875A', stick: true, onomatopoeia: '퉁!' },
  FLOOR_TOM: { id: 'FLOOR_TOM', label: '플로어탐', short: 'FT', color: '#C5563F', stick: true, onomatopoeia: '둥!' },
  RIDE: { id: 'RIDE', label: '라이드', short: 'RD', color: '#5FB8AE', stick: true, onomatopoeia: '팅!' },
  KICK: { id: 'KICK', label: '킥', short: 'KK', color: '#8C7BFF', stick: false, onomatopoeia: '쿵!' },
};

/** 노트 레인 순서 (왼쪽 → 오른쪽). 실제 드럼 배치와 비슷하게 둔다. */
export const LANE_ORDER: PadId[] = ['CRASH', 'HIHAT', 'SNARE', 'HI_TOM', 'FLOOR_TOM', 'RIDE', 'KICK'];

export const ALL_PADS: PadId[] = LANE_ORDER;

/** 스틱 캘리브레이션 대상 패드 (KICK 제외) */
export const STICK_PADS: PadId[] = LANE_ORDER.filter((p) => PAD_META[p].stick);
