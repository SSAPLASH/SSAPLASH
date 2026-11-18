// 실물 드럼 그림의 패드별 자리 표. FE/scripts/kit-art/build.py가 만든다 — 손으로 고치지 않는다.
// 단위: head·ring·label·judge·badge·top은 조각 상자의 폭을 160으로 본 "그림 단위"(Pad가 쓰는 폭 160 기준과 같다),
// kit·box는 킷 단위(킷 폭 760)다. 이미지 파일은 components/drum/acoustic이 sprite 이름으로 찾는다.
import type { PadShape } from './drumKit';
import type { PadId } from './pads';

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
  /** 심벌만: 흔들리는 원판 조각과 받침 상자 안에서의 자리. closeDy는 원근 그림의 하이햇만 — 닫힐 때 내려가는 거리 */
  top?: { sprite: string; x: number; y: number; w: number; h: number; closeDy?: number };
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
      top: { sprite: 'crash-top', x: 1.3, y: 1.0, w: 157.3, h: 112.8 },
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
      top: { sprite: 'ride-top', x: 0.8, y: 0.8, w: 158.1, h: 114.6 },
    },
    {
      pad: 'SMALL_TOM',
      shape: 'drum',
      sprite: 'small-tom',
      boxH: 310.4,
      head: { cx: 81.0, cy: 58.3, rx: 73.0, ry: 53.5 },
      ring: { cx: 81.0, cy: 58.3, rx: 79.6, ry: 59.9 },
      label: { x: 81.0, y: 125.8 },
      judge: { x: 81.0, y: 8.0 },
      badge: { x: 81.0, y: 10.0 },
      kit: { left: 166.1, top: 58.8, w: 103.9 },
    },
    {
      pad: 'MID_TOM',
      shape: 'drum',
      sprite: 'mid-tom',
      boxH: 316.7,
      head: { cx: 82.0, cy: 59.4, rx: 74.3, ry: 54.5 },
      ring: { cx: 82.0, cy: 59.4, rx: 81.0, ry: 61.0 },
      label: { x: 82.0, y: 127.9 },
      judge: { x: 82.0, y: 8.0 },
      badge: { x: 82.0, y: 10.0 },
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
      head: { cx: 79.8, cy: 44.5, rx: 51.1, ry: 36.6 },
      ring: { cx: 79.8, cy: 44.5, rx: 55.7, ry: 41.0 },
      label: { x: 79.8, y: 95.1 },
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

/** 위에서 본 그림(작은 킷) */
export const KIT_ART_TOP: KitArt = {
  box: { w: 760, h: 650.7 },
  pads: [
    {
      pad: 'KICK',
      shape: 'kick',
      sprite: 'kick',
      boxH: 216.8,
      head: { cx: 79.3, cy: 52.4, rx: 63.4, ry: 47.2 },
      ring: { cx: 79.3, cy: 52.4, rx: 69.1, ry: 52.9 },
      label: { x: 79.3, y: 28.8 },
      judge: { x: 79.3, y: 8.0 },
      badge: { x: 79.3, y: 10.0 },
      kit: { left: 242.5, top: 11.1, w: 266.4 },
    },
    {
      pad: 'SMALL_TOM',
      shape: 'drum',
      sprite: 'small-tom',
      boxH: 145.9,
      head: { cx: 93.8, cy: 68.9, rx: 55.4, ry: 54.9 },
      ring: { cx: 93.8, cy: 68.9, rx: 60.4, ry: 61.5 },
      label: { x: 93.8, y: 137.8 },
      judge: { x: 93.8, y: 8.0 },
      badge: { x: 93.8, y: 10.0 },
      kit: { left: 170.7, top: 188.5, w: 181.7 },
    },
    {
      pad: 'MID_TOM',
      shape: 'drum',
      sprite: 'mid-tom',
      boxH: 153.5,
      head: { cx: 65.0, cy: 73.7, rx: 58.0, ry: 58.5 },
      ring: { cx: 65.0, cy: 73.7, rx: 63.2, ry: 65.5 },
      label: { x: 65.0, y: 146.2 },
      judge: { x: 65.0, y: 8.0 },
      badge: { x: 65.0, y: 10.0 },
      kit: { left: 396.0, top: 188.5, w: 180.5 },
    },
    {
      pad: 'SNARE',
      shape: 'drum',
      sprite: 'snare',
      boxH: 190.4,
      head: { cx: 89.4, cy: 68.9, rx: 61.4, ry: 60.7 },
      ring: { cx: 89.4, cy: 68.9, rx: 66.9, ry: 68.0 },
      label: { x: 89.4, y: 143.6 },
      judge: { x: 89.4, y: 8.0 },
      badge: { x: 89.4, y: 10.0 },
      kit: { left: 163.3, top: 366.5, w: 203.8 },
    },
    {
      pad: 'FLOOR_TOM',
      shape: 'drum',
      sprite: 'floor-tom',
      boxH: 153.5,
      head: { cx: 72.9, cy: 75.8, rx: 54.5, ry: 54.0 },
      ring: { cx: 72.9, cy: 75.8, rx: 59.4, ry: 60.5 },
      label: { x: 72.9, y: 143.8 },
      judge: { x: 72.9, y: 11.8 },
      badge: { x: 72.9, y: 10.0 },
      kit: { left: 464.1, top: 319.8, w: 289.1 },
    },
    {
      pad: 'HIHAT',
      shape: 'cymbal',
      sprite: 'hihat-base',
      boxH: 329.4,
      head: { cx: 78.1, cy: 175.1, rx: 110.1, ry: 111.1 },
      ring: { cx: 78.1, cy: 175.1, rx: 120.0, ry: 124.4 },
      label: { x: 78.1, y: 300.2 },
      judge: { x: 78.1, y: 54.0 },
      badge: { x: 78.1, y: 50.0 },
      kit: { left: 43.6, top: 295.9, w: 104.4 },
      top: { sprite: 'hihat-top', x: -34.8, y: 62.1, w: 226.8, h: 217.4 },
    },
    {
      pad: 'CRASH',
      shape: 'cymbal',
      sprite: 'crash',
      boxH: 155.4,
      head: { cx: 53.6, cy: 34.3, rx: 89.1, ry: 87.1 },
      ring: { cx: 53.6, cy: 34.3, rx: 97.1, ry: 97.6 },
      label: { x: 53.6, y: 135.4 },
      judge: { x: 53.6, y: 8.0 },
      badge: { x: 53.6, y: 10.0 },
      kit: { left: 55.9, top: 115.4, w: 193.4 },
      top: { sprite: 'crash-top', x: -37.1, y: -53.8, w: 181.8, h: 177.3 },
    },
    {
      pad: 'RIDE',
      shape: 'cymbal',
      sprite: 'ride',
      boxH: 149.7,
      head: { cx: 77.5, cy: 49.8, rx: 67.6, ry: 71.1 },
      ring: { cx: 77.5, cy: 49.8, rx: 73.7, ry: 79.6 },
      label: { x: 77.5, y: 134.9 },
      judge: { x: 77.5, y: 8.0 },
      badge: { x: 77.5, y: 10.0 },
      kit: { left: 499.7, top: 86.6, w: 258.4 },
      top: { sprite: 'ride-top', x: 8.7, y: -22.4, w: 139.1, h: 144.8 },
    },
    {
      pad: 'HIHAT_PEDAL',
      shape: 'pedal',
      sprite: 'hihat-pedal',
      boxH: 168.8,
      head: { cx: 80.0, cy: 84.4, rx: 78.6, ry: 83.1 },
      ring: { cx: 80.0, cy: 84.4, rx: 85.7, ry: 93.1 },
      label: { x: 80.0, y: 180.8 },
      judge: { x: 80.0, y: 8.0 },
      badge: { x: 80.0, y: 10.0 },
      kit: { left: 30.1, top: 486.8, w: 144.9 },
    },
  ],
};

/** 패드의 자리 항목. 그 그림에 없는 패드면 undefined */
export function kitArtPad(art: KitArt, pad: PadId): KitArtPad | undefined {
  return art.pads.find((p) => p.pad === pad);
}

/**
 * 원근 그림에서 하이햇 페달 조각이 하이햇 받침 그림에 맞물리는 자리·크기. 받침 그림(hihat-base)은 페달 자리가 네모로 비어 있고
 * 페달 조각(hihat-pedal)이 그 네모를 채운다. 이 비율로 놓아야 이음매 없이 한 그림으로 보인다(다르게 놓으면 페달이 잘려 보이고 받침에 구멍이 보인다).
 * 값은 하이햇 헤드 가로 반지름 대비다: dx·drop은 헤드 중심에서 페달 중심까지의 가로·세로 거리, size는 페달 가로 반지름
 */
export const HIHAT_PEDAL_FIT: { dx: number; drop: number; size: number } = (() => {
  const hh = KIT_ART_PERSP.pads.find((p) => p.pad === 'HIHAT')!;
  const pedal = KIT_ART_PERSP.pads.find((p) => p.pad === 'HIHAT_PEDAL')!;
  /** 하이햇 조각 상자(폭 160) 단위 ÷ 킷 단위 */
  const u = 160 / hh.kit.w;
  /** 페달 조각 상자(폭 160) 단위 → 킷 단위 */
  const k = pedal.kit.w / 160;
  const px = (pedal.kit.left + pedal.head.cx * k - hh.kit.left) * u;
  const py = (pedal.kit.top + pedal.head.cy * k - hh.kit.top) * u;
  return { dx: (px - hh.head.cx) / hh.head.rx, drop: (py - hh.head.cy) / hh.head.rx, size: (pedal.head.rx * k * u) / hh.head.rx };
})();
