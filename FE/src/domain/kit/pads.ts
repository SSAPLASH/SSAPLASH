// 패드 정의 — 공통 명세서 5장·9-2 enum 표기를 그대로 따른다.
// 배치 타입은 domain/kit/kitLayout로 옮겼다. 기존 import 경로 호환용 재export
export type { KitLayout, PadPlacement } from './kitLayout';

export type PadId =
  | 'CRASH'
  | 'HIHAT'
  | 'SNARE'
  | 'SMALL_TOM'
  | 'MID_TOM'
  | 'FLOOR_TOM'
  | 'RIDE'
  | 'KICK'
  | 'HIHAT_PEDAL';

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
  SMALL_TOM: { id: 'SMALL_TOM', label: '스몰탐', short: 'ST', color: '#E0875A', stick: true, onomatopoeia: '퉁!' },
  MID_TOM: { id: 'MID_TOM', label: '미드탐', short: 'MT', color: '#D9794F', stick: true, onomatopoeia: '통!' },
  FLOOR_TOM: { id: 'FLOOR_TOM', label: '플로어탐', short: 'FT', color: '#C5563F', stick: true, onomatopoeia: '둥!' },
  RIDE: { id: 'RIDE', label: '라이드', short: 'RD', color: '#5FB8AE', stick: true, onomatopoeia: '팅!' },
  KICK: { id: 'KICK', label: '킥', short: 'KK', color: '#8C7BFF', stick: false, onomatopoeia: '쿵!' },
  HIHAT_PEDAL: { id: 'HIHAT_PEDAL', label: '하이햇 페달', short: 'HP', color: '#A8863F', stick: false, onomatopoeia: '칙!' },
};

/** 전체 패드(저장·enum 검증·통계·악보 줄). 실제 드럼 배치와 비슷한 순서 */
export const ALL_PADS: PadId[] = [
  'CRASH',
  'HIHAT',
  'SNARE',
  'SMALL_TOM',
  'MID_TOM',
  'FLOOR_TOM',
  'RIDE',
  'KICK',
  'HIHAT_PEDAL',
];

/**
 * 화면에 그리는 패드 (노트 레인 왼쪽 → 오른쪽, 킷 보기·칩 목록). 9종 전부이고 하이햇 페달은 하이햇 왼쪽.
 * 킷 보기는 이 순서가 아니라 kitLayout 좌표로 그린다. 저장·통계 순서는 ALL_PADS
 */
export const LANE_PADS: PadId[] = [
  'CRASH',
  'HIHAT_PEDAL',
  'HIHAT',
  'SNARE',
  'SMALL_TOM',
  'MID_TOM',
  'FLOOR_TOM',
  'RIDE',
  'KICK',
];

/** 스틱 캘리브레이션 대상 패드 (KICK·HIHAT_PEDAL 제외) */
export const STICK_PADS: PadId[] = ALL_PADS.filter((p) => PAD_META[p].stick);

/** 옛 이름 → 현재 이름. 별칭은 이 표 한 곳에서만 관리한다 */
export const LEGACY_PAD_ALIASES: Record<string, PadId> = {
  HI_TOM: 'SMALL_TOM',
};

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** 임의 문자열을 PadId로. 옛 이름은 변환, 알 수 없으면 null */
export function normalizePadId(raw: string): PadId | null {
  if (has(PAD_META, raw)) return raw as PadId;
  if (has(LEGACY_PAD_ALIASES, raw)) return LEGACY_PAD_ALIASES[raw];
  return null;
}

/** 패드 키 객체의 키를 normalizePadId로 바꾼다. 모르는 키는 버리고, 충돌하면 새 이름 키의 값이 이긴다 */
export function normalizePadKeys<T>(rec: Record<string, T>): Partial<Record<PadId, T>> {
  const out: Partial<Record<PadId, T>> = {};
  // 옛 이름을 먼저 넣고 새 이름이 덮어쓰게 한다
  for (const [k, v] of Object.entries(rec)) {
    if (has(LEGACY_PAD_ALIASES, k)) out[LEGACY_PAD_ALIASES[k]] = v;
  }
  for (const [k, v] of Object.entries(rec)) {
    if (has(PAD_META, k)) out[k as PadId] = v;
  }
  return out;
}
