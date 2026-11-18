// 연주 화면 드럼 킷(Figma Play / DrumKit) 고정 배치·상태 상수·크기 계산.
// 판정용 배치(kitLayout)와는 별개로, 표시 전용이다. 그리기는 components/drum이 한다.
// 실물 스킨의 자리는 그림 자리 표(kit/kitArt)에서 온다. 전자·네온은 이 파일의 평면 배치표를 쓴다.
import { KIT_ART_PERSP, KIT_ART_TOP, type KitArt, type KitArtPad } from './kitArt';
import { PAD_META, type PadId } from './pads';

/** pedal은 하이햇 페달(발판). 실물 스킨의 고정 킷과 드럼 세팅의 자유 틀(DrumKit frame)에서 그린다 */
export type PadShape = 'drum' | 'cymbal' | 'kick' | 'pedal';

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
  /** 실물 스킨만: 이 패드 그림의 헤드·링·글자 자리. 없으면 모양별 상수를 쓴다 */
  art?: KitArtPad;
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

/** 킷 원본 폭(px). 모든 스킨이 같다 */
export const DRUM_KIT_W = 760;
/** 전자·네온 킷의 원본 높이. 실물은 그림마다 달라 kitBoxFor로 읽는다 */
export const DRUM_KIT_H = 300;

/**
 * 실물 스킨의 그림 종류. persp = 원근 그림(큰 킷), top = 위에서 본 그림(작은 킷).
 * 전자·네온은 평면 하나뿐이라 무시한다
 */
export type KitView = 'persp' | 'top';

/** 실물 그림 자리 표(view별) */
function artOf(view: KitView): KitArt {
  return view === 'top' ? KIT_ART_TOP : KIT_ART_PERSP;
}

/** 스킨별 킷 상자(원본 px). scale 1일 때 렌더 크기다. view는 실물 스킨에서만 뜻이 있다 */
export function kitBoxFor(skin: KitSkin, view: KitView = 'persp'): { w: number; h: number } {
  return skin === 'acoustic' ? artOf(view).box : { w: DRUM_KIT_W, h: DRUM_KIT_H };
}

/** 타격 점등 지속 시간(ms) */
export const HIT_MS = 220;
/** 판정(PERFECT/GOOD/MISS) 표시 지속 시간(ms) */
export const JUDGE_MS = 400;

/** 그림 자리 표 → 고정 배치표 */
const padsFromArt = (kitArt: KitArt): readonly DrumKitPad[] =>
  kitArt.pads.map((art) => ({
    pad: art.pad,
    shape: art.shape,
    left: art.kit.left,
    top: art.kit.top,
    w: art.kit.w,
    h: (art.kit.w * art.boxH) / 160,
    label: PAD_META[art.pad].label,
    art,
  }));

/** 실물 스킨의 고정 배치(원근): 그림 자리 표의 9패드(하이햇 페달 포함). 배열 순서가 겹침 순서(뒤 → 앞)다 */
export const DRUM_KIT_PADS: readonly DrumKitPad[] = padsFromArt(KIT_ART_PERSP);

/** 실물 스킨의 고정 배치(위에서 본 그림, 작은 킷). 9패드이고 하이햇 원판은 열림·닫힘 이동이 없다 */
export const DRUM_KIT_PADS_TOP: readonly DrumKitPad[] = padsFromArt(KIT_ART_TOP);

/** 원 중심(cx, cy)·지름 d → 좌상단 left/top, w = h = d. 라벨·태그는 PAD_META에서 가져온다 */
function flatPad(pad: PadId, shape: PadShape, cx: number, cy: number, d: number): DrumKitPad {
  return { pad, shape, left: cx - d / 2, top: cy - d / 2, w: d, h: d, label: PAD_META[pad].label, tag: PAD_META[pad].short };
}

/** 전자·네온 공용 평면 배치(2D라 겹침 없음, 순서는 DRUM_KIT_PADS와 같다). 원본 760×300 기준 */
export const DRUM_KIT_FLAT_PADS: readonly DrumKitPad[] = [
  flatPad('CRASH', 'cymbal', 140, 70, 136),
  flatPad('RIDE', 'cymbal', 670, 95, 168),
  flatPad('SMALL_TOM', 'drum', 300, 65, 116),
  flatPad('MID_TOM', 'drum', 440, 65, 116),
  flatPad('HIHAT', 'cymbal', 75, 200, 128),
  flatPad('KICK', 'kick', 390, 215, 156),
  flatPad('SNARE', 'drum', 240, 210, 148),
  flatPad('FLOOR_TOM', 'drum', 545, 205, 156),
];

/** 스킨에 맞는 고정 배치표. 실물은 하이햇 페달까지 9패드, 전자·네온은 8패드 */
export function kitPadsFor(skin: KitSkin, view: KitView = 'persp'): readonly DrumKitPad[] {
  if (skin !== 'acoustic') return DRUM_KIT_FLAT_PADS;
  return view === 'top' ? DRUM_KIT_PADS_TOP : DRUM_KIT_PADS;
}

/** 라벨 글자 크기(원본 px). 12px × (패드 폭 / 160) */
export function labelFontSize(w: number): number {
  return 12 * (w / 160);
}

/** scale에서의 킷 렌더 크기(CSS px) */
export function kitSizeAt(scale: number, skin: KitSkin, view: KitView = 'persp'): { width: number; height: number } {
  const box = kitBoxFor(skin, view);
  return { width: box.w * scale, height: box.h * scale };
}

/** 리듬 게임·악보 연습 화면의 작은 킷 높이(CSS px). 실물(위에서 본 그림)일 때만 쓴다 */
export const PLAY_KIT_TOP_H = 200;
export const SHEET_KIT_TOP_H = 210;

/**
 * 작은 연주 킷(리듬 게임·악보 연습)의 그림 종류와 scale.
 * 실물은 위에서 본 그림을 화면별 높이(게임 200 · 악보 210px)에 맞추고, 전자·네온은 기존 scale 그대로다.
 * `fit`(쓸 수 있는 상자, CSS px)을 주면 그 상자에 들어가는 만큼 키운다 — 기본 크기보다 작아지지는 않는다(악보 연습, 설계 MODE-003-practice-speed D18)
 */
export function smallKitSpec(screen: 'play' | 'sheet', skin: KitSkin, fit?: { width: number; height: number }): { view: KitView; scale: number } {
  const flatScale = screen === 'play' ? 0.5 : 0.7;
  const view: KitView = skin === 'acoustic' ? 'top' : 'persp';
  const box = kitBoxFor(skin, view);
  const base = skin === 'acoustic' ? (screen === 'play' ? PLAY_KIT_TOP_H : SHEET_KIT_TOP_H) / box.h : flatScale;
  if (!fit) return { view, scale: base };
  return { view, scale: Math.max(base, Math.min(fit.width / box.w, fit.height / box.h)) };
}

/** 부모 가용 폭에 맞는 scale. maxScale을 넘지 않고, 폭이 0 이하면 0 */
export function fitScale(availableWidth: number, maxScale: number): number {
  if (!(availableWidth > 0)) return 0;
  return Math.min(maxScale, availableWidth / DRUM_KIT_W);
}

/** 폭·높이 상자 안에 들어가는 scale(contain). maxScale을 넘지 않고, 폭·높이 하나라도 0 이하면 0. boxH는 킷 상자 높이 */
export function fitScaleBox(availableWidth: number, availableHeight: number, maxScale: number, boxH: number = DRUM_KIT_H): number {
  if (!(availableWidth > 0) || !(availableHeight > 0)) return 0;
  return Math.min(maxScale, availableWidth / DRUM_KIT_W, availableHeight / boxH);
}

/** 타격 패드가 화면에서 점등될 패드. 하이햇 페달은 하이햇 패드에 표시한다 */
export function visualPadOf(pad: PadId): PadId | null {
  if (pad === 'HIHAT_PEDAL') return 'HIHAT';
  return pad;
}

/** 패드 모양별 "헤드 중심"(원본 160 기준). 전자·네온 배치에 쓴다. 실물은 패드별 그림 자리(art.head)를 쓴다 */
export const PAD_HEAD_CENTER: Record<PadShape, { x: number; y: number }> = {
  drum: { x: 80, y: 72 },
  cymbal: { x: 80, y: 70 },
  kick: { x: 80, y: 85 },
  pedal: { x: 80, y: 80 },
};

/** 패드 그림 안의 헤드 중심(원본 160 기준) */
function headCenter(p: DrumKitPad): { x: number; y: number } {
  return p.art ? { x: p.art.head.cx, y: p.art.head.cy } : PAD_HEAD_CENTER[p.shape];
}

/** 패드의 헤드 중심(킷 좌표) */
export function padCenter(p: DrumKitPad): { x: number; y: number } {
  const s = p.w / 160;
  const c = headCenter(p);
  return { x: p.left + c.x * s, y: p.top + c.y * s };
}

/**
 * 패드의 헤드 중심을 정규화 좌표(0~1, 킷 상자 기준)로 옮긴 사본. 크기는 그대로. boxH는 킷 상자 높이.
 * 보정 화면이 "실제 친 위치"에 패드를 놓을 때 쓴다(PLAY-004 4-1)
 */
export function placePad(p: DrumKitPad, x: number, y: number, boxH: number = DRUM_KIT_H): DrumKitPad {
  const s = p.w / 160;
  const c = headCenter(p);
  return { ...p, left: x * DRUM_KIT_W - c.x * s, top: y * boxH - c.y * s };
}
