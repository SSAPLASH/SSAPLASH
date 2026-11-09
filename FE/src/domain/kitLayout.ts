// 가상 키트 배치. 좌표는 0~1 정규화(화면 비율 무관). 순수 데이터·함수라 단위 테스트 대상.
// 배치는 표시 전용이다(PLAY-004 D2): 판정은 손별 앵커(settingsStore.stickAnchors)가 맡고,
// 보정이 끝나면 앵커에서 유도한 배치가 여기 형식으로 프리셋 layout에 저장된다.
import type { PadId } from './pads';

/**
 * 가상 키트 배치. 좌표는 0~1 정규화(화면 비율 무관).
 * 연주자 시점: 위쪽이 멀고(심벌), 아래쪽이 가깝다(스네어·킥).
 */
export interface PadPlacement {
  x: number;
  y: number;
  /** 반지름 (정규화 단위, 가로 기준). 표시 전용 */
  r: number;
}

export type KitLayout = Record<PadId, PadPlacement>;

/**
 * 시스템 기본 배치(고정값, PLAY-004 후속 T8). 사람이 디자인한 값이라 패드가 겹치지 않는다.
 * 보정 전 판정은 3D 모델 기본 앵커(kitModel)가 맡고, 이 배치는 화면 표시에만 쓴다
 */
export const DEFAULT_KIT_LAYOUT: KitLayout = {
  CRASH: { x: 0.2, y: 0.22, r: 0.1 },
  HIHAT: { x: 0.24, y: 0.52, r: 0.085 },
  SNARE: { x: 0.42, y: 0.68, r: 0.095 },
  SMALL_TOM: { x: 0.42, y: 0.34, r: 0.07 },
  MID_TOM: { x: 0.6, y: 0.34, r: 0.07 },
  FLOOR_TOM: { x: 0.72, y: 0.66, r: 0.1 },
  RIDE: { x: 0.8, y: 0.26, r: 0.11 },
  KICK: { x: 0.58, y: 0.9, r: 0.065 },
  HIHAT_PEDAL: { x: 0.24, y: 0.9, r: 0.055 },
};

/** 일부 패드만 있는 배치를 완전한 KitLayout으로 만든다. 없는 패드는 기본 배치 값을 쓴다 */
export function fillLayout(partial: Partial<KitLayout>): KitLayout {
  const out = {} as KitLayout;
  for (const pad of Object.keys(DEFAULT_KIT_LAYOUT) as PadId[]) {
    out[pad] = partial[pad] ?? DEFAULT_KIT_LAYOUT[pad];
  }
  return out;
}
