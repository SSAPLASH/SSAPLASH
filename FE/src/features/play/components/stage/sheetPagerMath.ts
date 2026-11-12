// 마디 고정 악보(SheetPager)의 순수 계산: 페이지당 마디 수, 슬롯별 마디, 커서 위치. 캔버스·DOM에 의존하지 않는다.
// 시각 입력(songTime)은 모두 격자 시각(곡 시각 − 격자 원점 offsetMs)이다. 0이 1마디 1박, 음수는 리드인.
import type { BarLayout } from '@/domain/sheet';
import { xInBar, xInBarContinuous } from '@/components/sheetmusic/sheetStripMath';
import { STAFF_BOTTOM_Y, STAFF_TOP_Y } from '@/components/sheetmusic/sheetStripDraw';

/** 보표·커서·박 번호가 차지하는 세로 범위(논리 px, 배율 1 기준). 캔버스가 더 높으면 이만큼을 세로 가운데에 놓는다 */
export const CONTENT_TOP = STAFF_TOP_Y - 46;
export const CONTENT_BOTTOM = STAFF_BOTTOM_Y + 56;
/** 악보를 키우는 배율의 최대·최소. 선 간격 10px이 최대 16px, 최소 12px이 된다 */
export const STAFF_SCALE_MAX = 1.6;
export const STAFF_SCALE_MIN = 1.2;

/**
 * 악보 영역 높이(CSS px)에 맞춘 악보 배율: 보표 콘텐츠 높이가 칸을 채우는 값을 [MIN, MAX]로 자른다.
 * 칸이 1.2배로도 모자라게 낮으면 최소가 이긴다(콘텐츠가 위아래로 조금 넘칠 수 있다)
 */
export function staffScale(heightPx: number): number {
  return Math.min(STAFF_SCALE_MAX, Math.max(STAFF_SCALE_MIN, heightPx / (CONTENT_BOTTOM - CONTENT_TOP)));
}

/** 악보 영역 폭(px)에 따른 페이지당 마디 수 */
export function barsPerPage(width: number): number {
  return width < 900 ? 2 : 4;
}

export interface PagerSlot {
  /** 슬롯에 그릴 마디 번호(0부터). 곡 끝 너머·준비 마디면 null */
  bar: number | null;
  /** true면 1마디 앞 빈 준비 마디(보표·마디선만). 이때 bar는 null */
  lead?: true;
  /** 아직 커서가 오지 않은 다음 페이지 마디(흐리게 그린다) */
  upcoming: boolean;
}

/**
 * 슬롯별 마디. 커서가 슬롯을 떠난 뒤 1박이 지나면 그 자리를 다음 페이지 마디로 바꿔 끼운다(upcoming).
 * 커서가 다음 페이지로 넘어가면 그 페이지가 현재 페이지이므로 커서 오른쪽 슬롯은 정상으로 보인다.
 * leadBars(준비 마디 수, 0 또는 1)가 있으면 악보 전체를 그만큼 오른쪽 칸으로 민다: 첫 페이지 앞 칸이 빈 준비 마디(lead)이고,
 * 커서가 준비 마디(격자 −leadBars마디 ~ 0)를 지나 그대로 1마디로 들어간다. 첫 칸으로 되돌아가는 점프가 없다(설계 D20)
 */
export function pagerSlots(songTime: number, barMs: number, beatMs: number, perPage: number, totalBars: number, leadBars = 0): PagerSlot[] {
  const t = Math.max(songTime + leadBars * barMs, 0);
  const b = Math.floor(t / barMs);
  const page = Math.floor(b / perPage);
  const k = b - page * perPage;
  return Array.from({ length: perPage }, (_, i): PagerSlot => {
    let vb: number;
    let upcoming = false;
    if (i >= k) {
      vb = page * perPage + i;
    } else {
      const leftAt = (page * perPage + i + 1) * barMs;
      if (t - leftAt >= beatMs) {
        vb = (page + 1) * perPage + i;
        upcoming = true;
      } else {
        vb = page * perPage + i;
      }
    }
    const bar = vb - leadBars;
    if (bar < 0) return { bar: null, lead: true, upcoming };
    return bar >= totalBars ? { bar: null, upcoming: false } : { bar, upcoming };
  });
}

/**
 * 커서가 있는 슬롯 번호와 마디 안 진행 비율 0..1. 준비 마디(leadBars) 앞(카운트다운·인트로)이면 첫 슬롯 왼쪽.
 * leadBars가 있으면 pagerSlots와 같은 만큼 칸을 밀어 준비 마디부터 커서가 움직인다
 */
export function cursorPos(songTime: number, barMs: number, perPage: number, leadBars = 0): { slot: number; ratio: number } {
  const t = songTime + leadBars * barMs;
  if (t < 0) return { slot: 0, ratio: 0 };
  const b = Math.floor(t / barMs);
  return { slot: b % perPage, ratio: Math.min(1, Math.max(0, (t - b * barMs) / barMs)) };
}

/** reduced-motion용: 격자 시각을 박 경계로 내린다 */
export function snapToBeat(songTime: number, beatMs: number): number {
  return Math.floor(songTime / beatMs) * beatMs;
}

/**
 * 노트 머리의 화면 위치(슬롯 안, 세로 정렬 offset 전). 현재 페이지(슬롯)에 없으면 null —
 * 다음 페이지 미리보기(upcoming)·곡 끝 너머 슬롯·다른 페이지 노트는 이펙트를 내지 않는다.
 */
export function noteHeadAt(args: {
  slots: readonly PagerSlot[];
  layoutOf: (bar: number) => BarLayout;
  noteIndex: number;
  /** 슬롯 i의 왼쪽 x */
  slotX: (i: number) => number;
  slotW: number;
  continuousStepsPerBar?: number;
  /** 보표 위치(반 칸 단위) → y */
  lineY: (line: number) => number;
}): { x: number; y: number } | null {
  const { slots, layoutOf, noteIndex, slotX, slotW, lineY, continuousStepsPerBar } = args;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot.bar === null || slot.upcoming) continue;
    const g = layoutOf(slot.bar).glyphs.find((gl) => gl.noteIndex === noteIndex);
    if (g) return { x: continuousStepsPerBar ? xInBarContinuous(slotX(i), slotW, g.xRatio, continuousStepsPerBar) : xInBar(slotX(i), slotW, g.xRatio), y: lineY(g.line) };
  }
  return null;
}

/** 일반 모드: 커서가 화면 안쪽에 도달하면 악보 전체를 같은 좌표계로 이동한다. */
export function flowGeometry(gridTime: number, barMs: number, stepsPerBar: number, width: number, gutter: number, barPx: number, totalBars: number, leadBars: number) {
  const t = Math.max(gridTime, -leadBars * barMs);
  const bar = Math.floor(t / barMs);
  const ratio = (t - bar * barMs) / barMs;
  const origin = gutter + leadBars * barPx;
  const worldCursor = xInBarContinuous(origin + bar * barPx, barPx, ratio, stepsPerBar);
  const scroll = Math.max(0, worldCursor - Math.max(gutter + Math.min(12, barPx / stepsPerBar / 2), width * 0.36));
  const barZeroX = origin - scroll;
  const first = Math.max(0, Math.floor(-barZeroX / barPx));
  const last = Math.min(totalBars - 1, Math.floor((width - barZeroX) / barPx));
  return { cursorX: worldCursor - scroll, barZeroX, first, last };
}
