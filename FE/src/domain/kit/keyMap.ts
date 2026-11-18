// 개발·시연용 고정 키보드 매핑. 설정에 저장하지 않는다. 매핑 규칙은 input/padMapper가 쓴다.
import type { PadId } from './pads';
import type { StickId } from '@/domain/events';

export interface KeyBinding {
  pad: PadId;
  stickId: StickId;
}

/** KeyboardEvent.code → 바인딩 */
export type KeyMap = Record<string, KeyBinding>;

/**
 * 고정 매핑. 양손 대칭. 왼손 = 스틱 0, 오른손 = 스틱 1.
 * 기능명세서 PLAY-10 예시(F/J 스네어, D/K 하이햇)를 따른다.
 * 키 표(스틱 0 / 스틱 1): R/U 크래시, D/K 하이햇, F/J 스네어, E/I 스몰탐, W/O 미드탐, C/M 플로어탐, T/Y 라이드,
 * Space 킥(스틱 1), B 하이햇 페달(스틱 1).
 */
export const KEY_MAP: KeyMap = {
  KeyF: { pad: 'SNARE', stickId: 0 },
  KeyJ: { pad: 'SNARE', stickId: 1 },
  KeyD: { pad: 'HIHAT', stickId: 0 },
  KeyK: { pad: 'HIHAT', stickId: 1 },
  KeyE: { pad: 'SMALL_TOM', stickId: 0 },
  KeyI: { pad: 'SMALL_TOM', stickId: 1 },
  KeyW: { pad: 'MID_TOM', stickId: 0 },
  KeyO: { pad: 'MID_TOM', stickId: 1 },
  KeyC: { pad: 'FLOOR_TOM', stickId: 0 },
  KeyM: { pad: 'FLOOR_TOM', stickId: 1 },
  KeyR: { pad: 'CRASH', stickId: 0 },
  KeyU: { pad: 'CRASH', stickId: 1 },
  KeyT: { pad: 'RIDE', stickId: 0 },
  KeyY: { pad: 'RIDE', stickId: 1 },
  Space: { pad: 'KICK', stickId: 1 },
  KeyB: { pad: 'HIHAT_PEDAL', stickId: 1 },
};
