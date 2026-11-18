// 노트 하이웨이 레인 순서 (설계 MODE-001-MODE-003-song-picker-guide 2차, U1). 왼쪽 → 오른쪽.
// 드럼이 놓인 순서(네온 킷 DRUM_KIT_FLAT_PADS 중심 x 순)이고, 가장 덜 쓰는 하이햇 페달만 맨 왼쪽에 떼어 둔다.
// 킷 뷰·칩 목록이 쓰는 LANE_PADS와는 별개다. 키보드 매핑(KEY_MAP)은 패드 기준이라 이 순서와 무관하다.
import type { PadId } from '@/domain/kit/pads';

export const HIGHWAY_LANES: PadId[] = [
  'HIHAT_PEDAL',
  'HIHAT',
  'CRASH',
  'SNARE',
  'SMALL_TOM',
  'KICK',
  'MID_TOM',
  'FLOOR_TOM',
  'RIDE',
];

/** 레인 색 묶음: 심벌(하이햇 페달·하이햇·크래시·라이드) · 북(스네어·탐) · 킥 */
export type LaneGroup = 'cymbal' | 'drum' | 'kick';

/** 네온 3색(U23). 킷 스킨과 무관하게 게임 노트·레인 플래시·MISS 파편이 이 색을 쓴다. 킷 그림·결과·리포트의 PAD_META.color와는 별개 */
export const LANE_COLOR: Record<LaneGroup, string> = {
  cymbal: '#ffc24a',
  drum: '#22e4ff',
  kick: '#ff3ec8',
};

export function laneGroupOf(pad: PadId): LaneGroup {
  switch (pad) {
    case 'KICK':
      return 'kick';
    case 'SNARE':
    case 'SMALL_TOM':
    case 'MID_TOM':
    case 'FLOOR_TOM':
      return 'drum';
    default:
      return 'cymbal';
  }
}

export function laneColorOf(pad: PadId): string {
  return LANE_COLOR[laneGroupOf(pad)];
}
