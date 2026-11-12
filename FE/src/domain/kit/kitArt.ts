// 실물 드럼 그림의 패드별 자리 표. FE/scripts/kit-art/build.py가 만든다 — 손으로 고치지 않는다.
// 단위: head·ring·label·judge·badge·top은 조각 상자의 폭을 160으로 본 "그림 단위"(Pad가 쓰는 폭 160 기준과 같다),
// kit·box는 킷 단위(킷 폭 760)다. 이미지 파일은 components/drum/acoustic이 sprite 이름으로 찾는다.
import type { PadShape } from '../drumKit';
import type { PadId } from '../pads';

export interface ArtEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface ArtPoint {
  x: number;
  y: number;
}

export interface KitArtPad {
  pad: PadId;
  /** 타격 모션 종류를 정한다 */
  shape: PadShape;
  /** 조각 이미지 이름 */
  sprite: string;
  /** 조각 상자의 높이(폭은 160) */
  boxH: number;
  /** 헤드 타원: 누름 영역·번쩍임·이펙트 자리·자유 틀 크기 맞춤의 기준 */
  head: ArtEllipse;
  /** 상태 링·코칭 링 */
  ring: ArtEllipse;
  label: ArtPoint;
  judge: ArtPoint;
  badge: ArtPoint;
  /** 고정 배치에서 조각 상자의 왼쪽 위와 폭(킷 단위) */
  kit: { left: number; top: number; w: number };
  /** 하이햇만: 윗판 조각. 받침 상자 안의 자리와, 닫힐 때 내려가는 거리 */
  top?: { sprite: string; x: number; y: number; w: number; h: number; closeDy: number };
}

export interface KitArt {
  /** 킷 상자(킷 단위) */
  box: { w: number; h: number };
  /** 그리는 순서(뒤 → 앞) */
  pads: readonly KitArtPad[];
}

/** 원근 그림(큰 킷) */
export const KIT_ART_PERSP: KitArt = {
  box: { w: 760, h: 486.9 },
  pads: [
    {
      pad: 'CRASH',
      shape: 'cymbal',
      sprite: 'crash',
      boxH: 275.5,
      head: { cx: 79.8, cy: 57.3, rx: 77.1, ry: 54.6 },
      ring: { cx: 79.8, cy: 57.3, rx: 84.0, ry: 61.2 },
      label: { x: 79.8, y: 125.9 },
      judge: { x: 79.8, y: 8.0 },
      badge: { x: 79.8, y: 10.0 },
      kit: { left: 22.8, top: 7.5, w: 123.1 },
    },
    {
      pad: 'RIDE',
      shape: 'cymbal',
      sprite: 'ride',
      boxH: 249.4,
      head: { cx: 79.7, cy: 58.0, rx: 77.8, ry: 55.8 },
      ring: { cx: 79.7, cy: 58.0, rx: 84.8, ry: 62.5 },
      label: { x: 79.7, y: 127.8 },
      judge: { x: 79.7, y: 8.0 },
      badge: { x: 79.7, y: 10.0 },
      kit: { left: 602.5, top: 5.2, w: 152.6 },
    },
    {
      pad: 'SMALL_TOM',
      shape: 'drum',
      sprite: 'small-tom',
      boxH: 310.4,
      head: { cx: 81.6, cy: 64.4, rx: 65.6, ry: 47.3 },
      ring: { cx: 81.6, cy: 64.4, rx: 71.5, ry: 53.0 },
      label: { x: 81.6, y: 125.7 },
      judge: { x: 81.6, y: 8.0 },
      badge: { x: 81.6, y: 10.0 },
      kit: { left: 166.1, top: 58.8, w: 103.9 },
    },
    {
      pad: 'MID_TOM',
      shape: 'drum',
      sprite: 'mid-tom',
      boxH: 316.7,
      head: { cx: 79.2, cy: 65.9, rx: 65.3, ry: 48.0 },
      ring: { cx: 79.2, cy: 65.9, rx: 71.2, ry: 53.8 },
      label: { x: 79.2, y: 127.9 },
      judge: { x: 79.2, y: 8.0 },
      badge: { x: 79.2, y: 10.0 },
      kit: { left: 482.7, top: 58.8, w: 101.6 },
    },
    {
      pad: 'KICK',
      shape: 'kick',
      sprite: 'kick',
      boxH: 214.6,
      head: { cx: 80.0, cy: 109.9, rx: 60.6, ry: 53.8 },
      ring: { cx: 80.0, cy: 109.9, rx: 66.1, ry: 60.3 },
      label: { x: 80.0, y: 83.0 },
      judge: { x: 80.0, y: 46.1 },
      badge: { x: 80.0, y: 42.1 },
      kit: { left: 274.7, top: 101.3, w: 212.0 },
    },
    {
      pad: 'HIHAT',
      shape: 'cymbal',
      sprite: 'hihat-base',
      boxH: 370.2,
      head: { cx: 86.0, cy: 66.5, rx: 67.2, ry: 38.3 },
      ring: { cx: 86.0, cy: 66.5, rx: 73.2, ry: 42.9 },
      label: { x: 86.0, y: 118.8 },
      judge: { x: 86.0, y: 18.2 },
      badge: { x: 86.0, y: 14.2 },
      kit: { left: 5.2, top: 204.2, w: 114.8 },
      top: { sprite: 'hihat-top', x: 17.3, y: -4.7, w: 137.6, h: 111.2, closeDy: 10.1 },
    },
    {
      pad: 'SNARE',
      shape: 'drum',
      sprite: 'snare',
      boxH: 263.8,
      head: { cx: 80.2, cy: 53.7, rx: 65.1, ry: 42.0 },
      ring: { cx: 80.2, cy: 53.7, rx: 71.0, ry: 47.0 },
      label: { x: 80.2, y: 109.7 },
      judge: { x: 80.2, y: 8.0 },
      badge: { x: 80.2, y: 10.0 },
      kit: { left: 139.4, top: 272.6, w: 127.0 },
    },
    {
      pad: 'FLOOR_TOM',
      shape: 'drum',
      sprite: 'floor-tom',
      boxH: 176.7,
      head: { cx: 79.8, cy: 43.0, rx: 51.1, ry: 35.0 },
      ring: { cx: 79.8, cy: 43.0, rx: 55.7, ry: 39.2 },
      label: { x: 79.8, y: 92.0 },
      judge: { x: 79.8, y: 8.0 },
      badge: { x: 79.8, y: 10.0 },
      kit: { left: 499.8, top: 254.7, w: 198.2 },
    },
    {
      pad: 'HIHAT_PEDAL',
      shape: 'pedal',
      sprite: 'hihat-pedal',
      boxH: 465.8,
      head: { cx: 80.0, cy: 232.9, rx: 77.2, ry: 230.1 },
      ring: { cx: 80.0, cy: 232.9, rx: 84.1, ry: 257.7 },
      label: { x: 80.0, y: 477.8 },
      judge: { x: 80.0, y: 8.0 },
      badge: { x: 80.0, y: 10.0 },
      kit: { left: 55.5, top: 378.8, w: 29.3 },
    },
  ],
};

/** 패드의 자리 항목. 그 그림에 없는 패드면 undefined */
export function kitArtPad(art: KitArt, pad: PadId): KitArtPad | undefined {
  return art.pads.find((p) => p.pad === pad);
}
