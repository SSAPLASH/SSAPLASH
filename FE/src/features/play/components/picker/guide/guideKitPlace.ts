// 악보 연습 안내 장면의 킷 자리(장면 논리 좌표 760×470). 스킨별로 킷 그림이 달라 연결선 끝 계산과 같은 변환을 쓴다.
import { DRUM_KIT_H, DRUM_KIT_W, kitBoxFor, type KitSkin, type KitView } from '@/domain/kit/drumKit';

/** 킷: 760×300 원본을 0.85배로 (57, 200)에 둔다 */
const KIT_X = 57;
const KIT_Y = 200;
const KIT_SCALE = 0.85;

/** 킷 칸(전자·네온 기준 760×300 × 0.85 = 646×255)의 폭·높이. 실물 스킨도 이 칸 안에 맞춘다 */
const KIT_AREA_W = DRUM_KIT_W * KIT_SCALE;
const KIT_AREA_H = DRUM_KIT_H * KIT_SCALE;

export interface GuideKitPlace {
  view: KitView;
  scale: number;
  /** 장면 좌표에서 킷 왼쪽 위와 폭 */
  x: number;
  y: number;
  w: number;
}

/**
 * 스킨별 킷 자리. 전자·네온은 (57, 200)에 0.85배. 실물은 위에서 본 그림(세로로 긴 상자)을 킷 칸 높이에 맞추고 칸 가운데에 둔다.
 * 연결선 끝도 같은 변환(x + 킷 좌표 × scale)으로 계산한다
 */
export function guideKitPlace(skin: KitSkin): GuideKitPlace {
  if (skin !== 'acoustic') return { view: 'persp', scale: KIT_SCALE, x: KIT_X, y: KIT_Y, w: KIT_AREA_W };
  const scale = KIT_AREA_H / kitBoxFor('acoustic', 'top').h;
  const w = DRUM_KIT_W * scale;
  return { view: 'top', scale, x: KIT_X + (KIT_AREA_W - w) / 2, y: KIT_Y, w };
}
