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
 * 시스템 기본 배치(고정값, PLAY-004 후속 T8). 스틱 패드의 x·y는 3D 모델(kitModel.PAD_POINTS)의 타격점을 두 손 가운데에서 본 방향이라,
 * 원근 그림의 자리와 보정 전 기본 판정 자리가 같은 모델에서 나온다(kitModel.test가 두 값이 맞는지 본다). 모델을 바꾸면 이 값도 다시 계산해 넣는다.
 * x·y는 방향이다(kitMapping.screenToPose: x 0.5가 정면, y 0.5가 수평). 원근 보기(kitPerspective)가 이 방향에 패드별 모델 거리를 곱해 3D 자리로 쓴다.
 * 원근 그림에서 패드가 서로 겹치지 않게 실제 드럼 세트처럼 넓게 벌려 놓았다: 스네어가 정면 아래, 하이햇이 왼쪽, 플로어탐이 오른쪽, 심벌이 위.
 * 킥은 세워진 베이스 드럼이라 가운데 가까이, 스네어와 플로어탐 사이로 가운데가 보이는 자리에 둔다. 하이햇 페달은 하이햇 바로 아래다.
 * 보정 전 판정은 3D 모델 기본 앵커(kitModel)가 맡고, 이 배치는 화면 표시에만 쓴다
 */
export const DEFAULT_KIT_LAYOUT: KitLayout = {
  CRASH: { x: 0.256, y: 0.247, r: 0.1 },
  HIHAT: { x: 0.084, y: 0.6, r: 0.085 },
  SNARE: { x: 0.416, y: 0.867, r: 0.095 },
  SMALL_TOM: { x: 0.388, y: 0.479, r: 0.07 },
  MID_TOM: { x: 0.612, y: 0.479, r: 0.07 },
  FLOOR_TOM: { x: 0.926, y: 0.793, r: 0.1 },
  RIDE: { x: 0.8, y: 0.289, r: 0.11 },
  KICK: { x: 0.57, y: 0.9, r: 0.065 },
  HIHAT_PEDAL: { x: 0.095, y: 0.9, r: 0.055 },
};

/** 일부 패드만 있는 배치를 완전한 KitLayout으로 만든다. 없는 패드는 기본 배치 값을 쓴다 */
export function fillLayout(partial: Partial<KitLayout>): KitLayout {
  const out = {} as KitLayout;
  for (const pad of Object.keys(DEFAULT_KIT_LAYOUT) as PadId[]) {
    out[pad] = partial[pad] ?? DEFAULT_KIT_LAYOUT[pad];
  }
  return out;
}

/** 그림 영역 상자(px 비율이면 충분) */
export interface FigBox {
  w: number;
  h: number;
}

/** 그림 크기 기준 길이: 16:10이면 폭, 더 넓으면 높이×1.6. 원근 보기의 초점 거리에 쓴다 */
export function radiusBasisOf(box: FigBox): number {
  return Math.min(box.w, box.h * 1.6);
}
