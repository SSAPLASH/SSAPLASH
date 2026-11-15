// 연속 그림(스프라이트 시트) 묶음 정의와 계산 — 묶음 표, 프레임 고르기, 패드 모양·헤드 비율 → 묶음 고르기.
// 그림 파일 불러오기·그리기는 components/fx가 한다. 여기는 순수 데이터·계산만 둔다.
import type { PadShape } from '@/domain/kit/drumKit';
import type { FxSheetId } from './types';

export interface FxSheetDef {
  id: FxSheetId;
  /** 정적 파일 경로(판 번호 v1을 붙여 오래 캐시한다) */
  src: string;
  /** 장수 */
  frames: number;
  /** 한 줄의 장수 */
  cols: number;
  /** 한 장의 한 변(px) */
  framePx: number;
  /** 재생 길이(ms, 재생 속도 1) */
  durMs: number;
  /** 시간표 지수: 프레임 i의 시각 = 길이 × (i ÷ (장수-1))^지수 */
  tpow: number;
  /** 그림 한 변이 헤드 가로 반지름의 몇 배인지 */
  span: number;
  /** 그림 안에서 헤드 중심의 세로 위치(0~1) */
  cy: number;
}

export const SHEET_FRAMES = 24;
export const SHEET_COLS = 6;
export const SHEET_FRAME_PX = 256;
/**
 * 패드 헤드 세로÷가로가 이 값 이상이면 정면(위·정면에서 본 원판) 그림을 쓴다.
 * 실물 킷의 큰 그림은 헤드 비율이 0.57~0.73(약 44° 위에서 본 각도)이라 옆 그림을 그 각도로 그렸다. 킥 0.89와 원판 1.0만 정면이다.
 */
export const FRONT_RATIO = 0.85;

function def(id: FxSheetId, durMs: number, tpow: number, span: number, cy: number): FxSheetDef {
  return { id, src: `/fx/${id}.v1.webp`, frames: SHEET_FRAMES, cols: SHEET_COLS, framePx: SHEET_FRAME_PX, durMs, tpow, span, cy };
}

export const SHEET_DEFS: Record<FxSheetId, FxSheetDef> = {
  'water-side-a': def('water-side-a', 640, 1.5, 3.8, 0.66),
  'water-side-b': def('water-side-b', 640, 1.5, 3.8, 0.66),
  'water-cymbal': def('water-cymbal', 520, 1.5, 3.8, 0.62),
  'water-front': def('water-front', 520, 1.5, 3.6, 0.46),
  'fire-side-a': def('fire-side-a', 500, 1.5, 3.6, 0.68),
  'fire-side-b': def('fire-side-b', 500, 1.5, 3.6, 0.68),
  'fire-cymbal': def('fire-cymbal', 440, 1.5, 4.2, 0.6),
  'fire-front': def('fire-front', 440, 1.5, 3.6, 0.56),
  'bolt-side-a': def('bolt-side-a', 360, 1.3, 3.6, 0.66),
  'bolt-side-b': def('bolt-side-b', 360, 1.3, 3.6, 0.66),
  'bolt-cymbal': def('bolt-cymbal', 360, 1.3, 4.2, 0.62),
  'bolt-front': def('bolt-front', 360, 1.3, 4.4, 0.5),
};

export interface SheetFrame {
  /** 앞 장 번호 */
  a: number;
  /** 뒤 장 번호(범위를 넘으면 -1 = 앞 장만 그린다) */
  b: number;
  /** 뒤 장을 섞는 비율 0~1 */
  mix: number;
}

/**
 * 나이(ms)에서 그릴 두 장을 고른다. 시간표를 거꾸로 풀어 u = (나이 ÷ 길이)^(1/지수) × (장수-1),
 * 앞 장 = floor(u), 뒤 장 = 앞 장 + 1, 섞는 비율 = u의 소수부. rate는 재생 속도(나이에 곱한다).
 * 나이가 음수이거나 길이 이상이면 null(없음).
 */
export function pickFrame(d: FxSheetDef, ageMs: number, rate = 1): SheetFrame | null {
  const age = ageMs * rate;
  if (age < 0 || age >= d.durMs) return null;
  const u = Math.pow(age / d.durMs, 1 / d.tpow) * (d.frames - 1);
  const a = Math.min(d.frames - 1, Math.floor(u));
  const b = a + 1 < d.frames ? a + 1 : -1;
  return { a, b, mix: u - a };
}

/**
 * 패드 모양·헤드 비율로 묶음을 고른다. 킥이거나 ry/rx ≥ FRONT_RATIO이면 front, 심벌이면 cymbal,
 * 그 밖의 드럼은 난수로 side-a/side-b. 페달이거나 해당 묶음이 목록에 없으면 null(그림 없이 입자만).
 * 난수는 드럼일 때만 한 번 쓴다.
 */
export function pickSheet(ids: readonly FxSheetId[], shape: PadShape, rx: number, ry: number, rand: () => number): FxSheetId | null {
  if (shape === 'pedal') return null;
  const ratio = rx > 0 ? ry / rx : 1;
  let suffix: string;
  if (shape === 'kick' || ratio >= FRONT_RATIO) suffix = 'front';
  else if (shape === 'cymbal') suffix = 'cymbal';
  else suffix = rand() < 0.5 ? 'side-a' : 'side-b';
  return ids.find((id) => id.endsWith(`-${suffix}`)) ?? null;
}
