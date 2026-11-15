// 악보 연습 화면에서 킷이 쓸 수 있는 상자(순수 계산, 설계 MODE-003-practice-speed D18·D20).
// HUD 아래 세로 높이를 악보 칸과 킷이 나눠 쓴다: 악보 칸이 43 %쯤(최소 274, 악보가 가장 크게 그려지는 높이까지), 나머지가 킷이다.
// 킷이 최대 크기에 닿으면 그 뒤로 남는 높이는 다시 악보 칸이 갖는다(PlayStage.css에서 악보 칸이 남는 높이를 채운다) — 킷 위아래에 빈 곳을 두지 않는다.
import { CONTENT_BOTTOM, CONTENT_TOP, OVERLAY_RESERVE_PX, staffScaleMax } from '@/features/play/components/stage/sheet/sheetPagerMath';

/** 악보 칸과 킷을 뺀 화면 세로 합: 위 여백 64 + HUD 96 + 구분선 17 + 간격 16 + 아래 여백 24 */
export const SHEET_CHROME_H = 64 + 96 + 17 + 16 + 24;
/** 악보 칸이 갖는 높이의 비율과 최소(악보 1.6배 + 타이밍 막대 자리) */
export const SHEET_AREA_SHARE = 0.43;
export const SHEET_AREA_BASE_H = 274;
/** 킷 높이의 최소(예전 고정값)·최대 */
export const SHEET_KIT_MIN_H = 210;
export const SHEET_KIT_MAX_H = 640;
/** 킷 양옆 칸(안내 칸·최근 타격)에 남겨 두는 최소 폭과 킷 사이 간격, 화면 좌우 여백 */
export const SHEET_SIDE_MIN_W = 280;
const SIDE_GAP = 16;
const STAGE_PAD_X = 24;
/** 악보 칸 안쪽 여유(보표 위아래) */
const SHEET_AREA_PAD = 9;

/** 악보가 그 폭에서 가장 크게 그려질 때 필요한 악보 칸 높이(CSS px): 보표 콘텐츠 × 최대 배율 + 타이밍 막대 자리 + 여유 */
export function sheetAreaMax(viewportW: number): number {
  const areaW = viewportW - 2 * STAGE_PAD_X;
  return Math.ceil((CONTENT_BOTTOM - CONTENT_TOP) * staffScaleMax(areaW) + OVERLAY_RESERVE_PX + SHEET_AREA_PAD);
}

/** 악보 칸이 갖고 싶은 높이: 남는 높이의 43 %를 [274, 그 폭의 최대]로 자른다 */
export function sheetAreaWant(viewportW: number, viewportH: number): number {
  const share = Math.round((viewportH - SHEET_CHROME_H) * SHEET_AREA_SHARE);
  return Math.min(sheetAreaMax(viewportW), Math.max(SHEET_AREA_BASE_H, share));
}

/** 화면 크기(CSS px)에서 킷이 쓸 수 있는 상자. 높이는 [210, 640], 폭은 양옆 칸 최소 폭을 뺀 나머지(0 이상) */
export function sheetKitFit(viewportW: number, viewportH: number): { width: number; height: number } {
  const room = Math.floor(viewportH - SHEET_CHROME_H - sheetAreaWant(viewportW, viewportH));
  const height = Math.min(SHEET_KIT_MAX_H, Math.max(SHEET_KIT_MIN_H, room));
  const width = Math.max(0, Math.floor(viewportW - 2 * STAGE_PAD_X - 2 * (SHEET_SIDE_MIN_W + SIDE_GAP)));
  return { width, height };
}
