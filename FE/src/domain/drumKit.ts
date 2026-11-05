// 연주 화면 드럼 킷(Figma Play / DrumKit 313:1381) 고정 배치·상태 상수·크기 계산.
// 판정용 배치(kitLayout)와는 별개로, 표시 전용이다. 그리기는 components/drum이 한다.
import type { PadId } from './pads';

export type PadShape = 'drum' | 'cymbal' | 'kick';

/** armed(예고)는 타입에만 두고 1차 범위에서는 쓰지 않는다 */
export type PadVisualState = 'idle' | 'armed' | 'hit' | 'perfect' | 'good' | 'miss';

/** 패드 위 알약 배지. level: now = 지금 강조, next = 기본, later = 흐리게. offGrid = 오른쪽 위 작은 점(격자 밖 노트) */
export interface PadBadge {
  text: string;
  level: 'now' | 'next' | 'later';
  offGrid?: boolean;
}

export interface DrumKitPad {
  pad: PadId;
  shape: PadShape;
  left: number;
  top: number;
  w: number;
  h: number;
  label: string;
  /** 영문 약어(2D 스킨 표시용). 실물 스킨은 쓰지 않는다 */
  tag?: string;
}

/** 드럼 모양(스킨). 소리·배치와 별개로 기기별 로컬 설정이다 */
export type KitSkin = 'acoustic' | 'electronic' | 'neon';
export const KIT_SKINS: readonly KitSkin[] = ['acoustic', 'electronic', 'neon'];
export const KIT_SKIN_LABELS: Record<KitSkin, string> = {
  acoustic: '실물 드럼',
  electronic: '전자 드럼',
  neon: '네온',
};

export function isKitSkin(v: unknown): v is KitSkin {
  return typeof v === 'string' && (KIT_SKINS as readonly string[]).includes(v);
}

/** 킷 원본 크기(px). scale 1일 때 렌더 크기 */
export const DRUM_KIT_W = 760;
export const DRUM_KIT_H = 300;

/** 타격 점등 지속 시간(ms) */
export const HIT_MS = 220;
/** 판정(PERFECT/GOOD/MISS) 표시 지속 시간(ms) */
export const JUDGE_MS = 400;

/** 패드 8개. 배열 순서가 겹침 순서(뒤 → 앞)다. HIHAT_PEDAL은 패드가 없다 */
export const DRUM_KIT_PADS: readonly DrumKitPad[] = [
  { pad: 'CRASH', shape: 'cymbal', left: 60, top: 0, w: 150, h: 140.6, label: '크래시' },
  { pad: 'RIDE', shape: 'cymbal', left: 590, top: 0, w: 160, h: 150, label: '라이드' },
  { pad: 'SMALL_TOM', shape: 'drum', left: 235, top: 6, w: 120, h: 112.5, label: '탐1' },
  { pad: 'MID_TOM', shape: 'drum', left: 405, top: 6, w: 120, h: 112.5, label: '탐2' },
  { pad: 'HIHAT', shape: 'cymbal', left: 20, top: 110, w: 130, h: 121.9, label: '하이햇' },
  { pad: 'KICK', shape: 'kick', left: 310, top: 118, w: 140, h: 148.8, label: '킥' },
  { pad: 'SNARE', shape: 'drum', left: 180, top: 140, w: 150, h: 140.6, label: '스네어' },
  { pad: 'FLOOR_TOM', shape: 'drum', left: 520, top: 130, w: 170, h: 159.4, label: '플로어탐' },
];

/** 원 중심(cx, cy)·지름 d → 좌상단 left/top, w = h = d */
function flatPad(pad: PadId, shape: PadShape, label: string, tag: string, cx: number, cy: number, d: number): DrumKitPad {
  return { pad, shape, left: cx - d / 2, top: cy - d / 2, w: d, h: d, label, tag };
}

/** 전자·네온 공용 평면 배치(2D라 겹침 없음, 순서는 DRUM_KIT_PADS와 같다). 원본 760×300 기준 */
export const DRUM_KIT_FLAT_PADS: readonly DrumKitPad[] = [
  flatPad('CRASH', 'cymbal', '크래시', 'CR', 140, 70, 136),
  flatPad('RIDE', 'cymbal', '라이드', 'RD', 670, 95, 168),
  flatPad('SMALL_TOM', 'drum', '탐1', 'T1', 300, 65, 116),
  flatPad('MID_TOM', 'drum', '탐2', 'T2', 440, 65, 116),
  flatPad('HIHAT', 'cymbal', '하이햇', 'HH', 75, 200, 128),
  flatPad('KICK', 'kick', '킥', 'KK', 390, 215, 156),
  flatPad('SNARE', 'drum', '스네어', 'SN', 240, 210, 148),
  flatPad('FLOOR_TOM', 'drum', '플로어탐', 'FT', 545, 205, 156),
];

/** 스킨에 맞는 8패드 배치표. 실물은 기존 표 그대로 */
export function kitPadsFor(skin: KitSkin): readonly DrumKitPad[] {
  return skin === 'acoustic' ? DRUM_KIT_PADS : DRUM_KIT_FLAT_PADS;
}

/** 라벨 글자 크기(원본 px). 12px × (패드 폭 / 160) */
export function labelFontSize(w: number): number {
  return 12 * (w / 160);
}

/** scale에서의 킷 렌더 크기(CSS px) */
export function kitSizeAt(scale: number): { width: number; height: number } {
  return { width: DRUM_KIT_W * scale, height: DRUM_KIT_H * scale };
}

/** 부모 가용 폭에 맞는 scale. maxScale을 넘지 않고, 폭이 0 이하면 0 */
export function fitScale(availableWidth: number, maxScale: number): number {
  if (!(availableWidth > 0)) return 0;
  return Math.min(maxScale, availableWidth / DRUM_KIT_W);
}

/** 타격 패드가 화면에서 점등될 패드. 하이햇 페달은 하이햇 패드에 표시한다 */
export function visualPadOf(pad: PadId): PadId | null {
  if (pad === 'HIHAT_PEDAL') return 'HIHAT';
  return pad;
}

/** 패드 모양별 "헤드 중심"(원본 160 기준). Pad.tsx의 RING 기하와 같다 */
export const PAD_HEAD_CENTER: Record<PadShape, { x: number; y: number }> = {
  drum: { x: 80, y: 72 },
  cymbal: { x: 80, y: 70 },
  kick: { x: 80, y: 85 },
};

/** 패드의 헤드 중심(킷 좌표, 760×300) */
export function padCenter(p: DrumKitPad): { x: number; y: number } {
  const s = p.w / 160;
  const c = PAD_HEAD_CENTER[p.shape];
  return { x: p.left + c.x * s, y: p.top + c.y * s };
}

/**
 * 패드의 헤드 중심을 정규화 좌표(0~1, 킷 760×300 기준)로 옮긴 사본. 크기는 그대로.
 * 보정 화면이 "실제 친 위치"에 패드를 놓을 때 쓴다(PLAY-004 4-1)
 */
export function placePad(p: DrumKitPad, x: number, y: number): DrumKitPad {
  const s = p.w / 160;
  const c = PAD_HEAD_CENTER[p.shape];
  return { ...p, left: x * DRUM_KIT_W - c.x * s, top: y * DRUM_KIT_H - c.y * s };
}

/**
 * 배치 좌표(kitLayout, 16:10 캔버스의 0~1) → DrumKit 정규화 좌표(760×300). 가로는 그대로, 세로는 킷의 패드 띠(0.15~0.77)로 눌러
 * 아래쪽 패드가 잘리지 않게 한다. 보정 화면이 "실제 친 위치"를 킷에 놓을 때 쓴다
 */
export function layoutToKitPoint(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x, y: 0.15 + 0.62 * p.y };
}
