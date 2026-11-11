// 드럼 세팅의 "자유 틀": 원근 자리(kitPerspective)에 스킨 패드 그림(components/drum/Pad)을 놓을 자리·크기를 구한다.
// 편집 화면(KitCanvas)과 보정 화면(CalibrationStage)이 같은 값으로 DrumKit을 그려 두 화면의 드럼 모양이 같다.
import { DRUM_KIT_PADS, PAD_HEAD_CENTER, type KitSkin, type PadShape } from './drumKit';
import type { FigBox, KitLayout } from './kitLayout';
import { DEFAULT_ANGLE_RANGE, type AngleRange } from './kitMapping';
import { kitShapes, makeCamera, padPoint, padShape, type PadShape as PadFigure } from './kitPerspective';
import { LANE_PADS, type PadId } from './pads';

/** 틀 안의 패드 하나. 좌표는 틀 px */
export interface FramePad {
  pad: PadId;
  shape: PadShape;
  label: string;
  tag: string;
  /** 패드 그림 상자의 왼쪽 위와 폭(그림 원본은 폭 160 기준) */
  left: number;
  top: number;
  w: number;
  /** 전자·네온 원판의 세로 눌림 배율. 없으면 누르지 않는다 */
  tilt?: number;
}

/** 틀: 크기(px)와 패드 목록(먼 것부터 = 그리는 순서) */
export interface KitFrame {
  w: number;
  h: number;
  pads: FramePad[];
}

/** 패드별 그림 모양·이름. 고정 8패드 표(DRUM_KIT_PADS)에 하이햇 페달을 더한다 */
const FRAME_DEFS: Record<PadId, { shape: PadShape; label: string; tag: string }> = (() => {
  const tags: Partial<Record<PadId, string>> = { CRASH: 'CR', RIDE: 'RD', SMALL_TOM: 'T1', MID_TOM: 'T2', HIHAT: 'HH', KICK: 'KK', SNARE: 'SN', FLOOR_TOM: 'FT' };
  const out = {} as Record<PadId, { shape: PadShape; label: string; tag: string }>;
  for (const p of DRUM_KIT_PADS) out[p.pad] = { shape: p.shape, label: p.label, tag: tags[p.pad] ?? '' };
  out.HIHAT_PEDAL = { shape: 'pedal', label: '페달', tag: 'HP' };
  return out;
})();

/** 그림 원본(폭 160)에서 "화면 가로 반지름"에 해당하는 길이. 실물은 헤드 테두리, 전자·네온은 원판 테두리 */
const ART_RX: Record<'acoustic' | 'flat', Record<PadShape, number>> = {
  acoustic: { drum: 79, cymbal: 79, kick: 80, pedal: 34 },
  flat: { drum: 76, cymbal: 76, kick: 76, pedal: 36 },
};

/** 원근 모양 하나 → 스킨 그림 자리 */
export function framePad(fig: PadFigure, skin: KitSkin): FramePad {
  const def = FRAME_DEFS[fig.pad];
  const flat = skin !== 'acoustic';
  const w = (fig.rx * 160) / ART_RX[flat ? 'flat' : 'acoustic'][def.shape];
  const s = w / 160;
  // 전자·네온은 원 중심이 (80,80), 실물은 모양별 헤드 중심
  const c = flat ? { x: 80, y: 80 } : PAD_HEAD_CENTER[def.shape];
  // 킥은 세워져 있어 누르지 않는다. 그 밖의 전자·네온 원판은 원근 타원 비율만큼 누른다
  const tilt = flat && def.shape !== 'kick' ? Math.min(1, Math.max(0.3, fig.ry / fig.rx)) : undefined;
  return { pad: fig.pad, ...def, left: fig.cx - c.x * s, top: fig.cy - c.y * s, w, tilt };
}

/** 원근 모양 목록(먼 것부터) → 틀 */
export function frameOf(figs: readonly PadFigure[], box: FigBox, skin: KitSkin): KitFrame {
  return { w: box.w, h: box.h, pads: figs.map((f) => framePad(f, skin)) };
}

/** 배치 전체의 틀. pads를 주면 그 패드만(보정 화면: 스틱 패드만), 없으면 9개 전부 */
export function kitFrame(layout: KitLayout, box: FigBox, skin: KitSkin, range: AngleRange = DEFAULT_ANGLE_RANGE, pads?: readonly PadId[]): KitFrame {
  const cam = makeCamera(box);
  if (!pads) return frameOf(kitShapes(layout, cam, range), box, skin);
  const want = LANE_PADS.filter((p) => pads.includes(p));
  const figs = want.map((pad) => padShape(pad, padPoint(pad, layout[pad], range), cam)).sort((a, b) => b.depth - a.depth);
  return frameOf(figs, box, skin);
}
