// 드럼 세팅의 "자유 틀": 원근 자리(kitPerspective)에 스킨 패드 그림(components/drum/Pad)을 놓을 자리·크기를 구한다.
// 편집 화면(KitCanvas)과 보정 화면(CalibrationStage)이 같은 값으로 DrumKit을 그려 두 화면의 드럼 모양이 같다.
import { DRUM_KIT_PADS, type KitSkin, type PadShape } from './drumKit';
import type { FigBox, KitLayout } from './kitLayout';
import { KIT_ART_PERSP, kitArtPad, type KitArtPad } from './kitArt';
import { DEFAULT_ANGLE_RANGE, type AngleRange } from './kitMapping';
import { kitShapes, makeCamera, type PadShape as PadFigure } from './kitPerspective';
import type { PadId } from './pads';

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
  /** 실물 스킨만: 이 패드 그림의 자리 */
  art?: KitArtPad;
}

/** 틀: 크기(px)와 패드 목록(먼 것부터 = 그리는 순서) */
export interface KitFrame {
  w: number;
  h: number;
  pads: FramePad[];
}

/** 패드별 그림 모양·이름. 실물 고정 배치표(DRUM_KIT_PADS)에서 가져오고 하이햇 페달은 짧은 이름을 쓴다 */
const FRAME_DEFS: Record<PadId, { shape: PadShape; label: string; tag: string }> = (() => {
  const tags: Partial<Record<PadId, string>> = { CRASH: 'CR', RIDE: 'RD', SMALL_TOM: 'T1', MID_TOM: 'T2', HIHAT: 'HH', KICK: 'KK', SNARE: 'SN', FLOOR_TOM: 'FT' };
  const out = {} as Record<PadId, { shape: PadShape; label: string; tag: string }>;
  for (const p of DRUM_KIT_PADS) out[p.pad] = { shape: p.shape, label: p.label, tag: tags[p.pad] ?? '' };
  out.HIHAT_PEDAL = { shape: 'pedal', label: '페달', tag: 'HP' };
  return out;
})();

/** 전자·네온 그림 원본(폭 160)에서 "화면 가로 반지름"에 해당하는 길이(원판 테두리) */
const FLAT_RX: Record<PadShape, number> = { drum: 76, cymbal: 76, kick: 76, pedal: 36 };

/** 원근 모양 하나 → 스킨 그림 자리 */
export function framePad(fig: PadFigure, skin: KitSkin): FramePad {
  const def = FRAME_DEFS[fig.pad];
  const art = skin === 'acoustic' ? kitArtPad(KIT_ART_PERSP, fig.pad) : undefined;
  if (art) {
    // 실물: 그림의 헤드 가로 반지름이 원근 타원의 가로 반지름과 같아지게 키우고, 헤드 중심을 원근 점에 둔다
    const w = (fig.rx * 160) / art.head.rx;
    const s = w / 160;
    return { pad: fig.pad, ...def, left: fig.cx - art.head.cx * s, top: fig.cy - art.head.cy * s, w, art };
  }
  // 전자·네온은 원 중심이 (80,80)
  const w = (fig.rx * 160) / FLAT_RX[def.shape];
  const s = w / 160;
  // 킥은 세워져 있어 누르지 않는다. 그 밖의 원판은 원근 타원 비율만큼 누른다
  const tilt = def.shape !== 'kick' ? Math.min(1, Math.max(0.3, fig.ry / fig.rx)) : undefined;
  return { pad: fig.pad, ...def, left: fig.cx - 80 * s, top: fig.cy - 80 * s, w, tilt };
}

/** 원근 모양 목록(먼 것부터) → 틀 */
export function frameOf(figs: readonly PadFigure[], box: FigBox, skin: KitSkin): KitFrame {
  return { w: box.w, h: box.h, pads: figs.map((f) => framePad(f, skin)) };
}

/** 배치 전체의 틀. pads를 주면 그 패드만(보정 화면: 스틱 패드만), 없으면 9개 전부 */
export function kitFrame(layout: KitLayout, box: FigBox, skin: KitSkin, range: AngleRange = DEFAULT_ANGLE_RANGE, pads?: readonly PadId[]): KitFrame {
  const cam = makeCamera(box, range);
  if (!pads) return frameOf(kitShapes(layout, cam, range), box, skin);
  return frameOf(
    kitShapes(layout, cam, range).filter((s) => pads.includes(s.pad)),
    box,
    skin,
  );
}
