// 가상 키트 배치. 좌표는 0~1 정규화(화면 비율 무관). 순수 데이터·함수라 단위 테스트 대상.
// 배치는 표시 전용이다(PLAY-004 D2): 판정은 손별 앵커(settingsStore.stickAnchors)가 맡고,
// 보정이 끝나면 앵커에서 유도한 배치가 여기 형식으로 프리셋 layout에 저장된다.
import { defaultLayout } from './kitModel';
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

/** 기본 배치: 3D 드럼셋 모델(kitModel)의 양손 평균 방향을 화면에 투영한 값 */
export const DEFAULT_KIT_LAYOUT: KitLayout = defaultLayout();

/** 일부 패드만 있는 배치를 완전한 KitLayout으로 만든다. 없는 패드는 기본 배치 값을 쓴다 */
export function fillLayout(partial: Partial<KitLayout>): KitLayout {
  const out = {} as KitLayout;
  for (const pad of Object.keys(DEFAULT_KIT_LAYOUT) as PadId[]) {
    out[pad] = partial[pad] ?? DEFAULT_KIT_LAYOUT[pad];
  }
  return out;
}
