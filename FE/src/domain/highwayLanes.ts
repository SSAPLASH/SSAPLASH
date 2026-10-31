// 노트 하이웨이 레인 순서 (Figma Play 112:499, D10). 왼쪽 → 오른쪽.
// 하이햇 페달이 맨 왼쪽이고 나머지는 Figma 8레인 순서다. 킷 뷰·칩 목록이 쓰는 LANE_PADS와는 별개다.
import type { PadId } from './pads';

export const HIGHWAY_LANES: PadId[] = [
  'HIHAT_PEDAL',
  'HIHAT',
  'SNARE',
  'SMALL_TOM',
  'MID_TOM',
  'FLOOR_TOM',
  'RIDE',
  'CRASH',
  'KICK',
];
