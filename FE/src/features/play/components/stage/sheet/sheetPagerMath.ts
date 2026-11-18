// 마디 고정 악보(SheetPager)의 순수 계산: 페이지당 마디 수, 슬롯별 마디, 커서 위치. 캔버스·DOM에 의존하지 않는다.
// 시각 입력(songTime)은 모두 격자 시각(곡 시각 − 격자 원점 offsetMs)이다. 0이 1마디 1박, 음수는 리드인.
import type { BarLayout } from '@/domain/song/sheet';
import { xInBar, xInBarContinuous } from '@/components/sheetmusic/sheetStripMath';
import { STAFF_BOTTOM_Y, STAFF_TOP_Y } from '@/components/sheetmusic/sheetStripDraw';

/**
 * 보표·커서·박 번호·마디 번호가 차지하는 세로 범위(논리 px, 배율 1 기준). 캔버스가 더 높으면 이만큼을 세로 가운데에 놓는다.
 * 위 끝은 마디 번호(보표 위 40, 11px 글자) 윗부분까지 들어가게 보표 위 52로 잡는다
 */
export const CONTENT_TOP = STAFF_TOP_Y - 52;
export const CONTENT_BOTTOM = STAFF_BOTTOM_Y + 56;
/** 악보를 키우는 배율의 최대·최소. 선 간격 10px이 최대 16px, 최소 12px이 된다 */
export const STAFF_SCALE_MAX = 1.6;
export const STAFF_SCALE_MIN = 1.2;
/** 칸이 넓을 때의 최대 배율 */
export const STAFF_SCALE_WIDE_MAX = 2.6;
/**
 * 배율을 키워도 지켜야 하는 논리 폭(칸 ÷ 배율)의 최소. 논리 폭이 900 미만이면 한 화면에 두 마디를 그리는데(barsPerPage),
 * 그 두 마디가 네 마디 배치의 가장 좁은 마디(900 ÷ 4 = 225)보다 좁아지지 않는 폭이다: 225 × 2 + 왼쪽 여백 44
 */
export const STAFF_MIN_LOGICAL_WIDTH = 494;

/**
 * 칸 폭(CSS px)에 따른 최대 배율. 폭을 모르면 1.6이고, 폭이 넓으면 음표 간격이 지켜지는 만큼(논리 폭 494 이상) 2.6까지 커진다.
 * 배율이 커지면 논리 폭이 줄어 음표 사이가 좁아지므로 폭이 허락하는 만큼만 키운다(설계 MODE-003-practice-speed D20)
 */
export function staffScaleMax(widthPx?: number): number {
  if (widthPx === undefined || !(widthPx > 0)) return STAFF_SCALE_MAX;
  return Math.min(STAFF_SCALE_WIDE_MAX, Math.max(STAFF_SCALE_MAX, widthPx / STAFF_MIN_LOGICAL_WIDTH));
}

/**
 * 악보 영역 높이(CSS px)에 맞춘 악보 배율: 보표 콘텐츠 높이가 칸을 채우는 값을 [MIN, 폭에 따른 최대]로 자른다.
 * 칸이 1.2배로도 모자라게 낮으면 최소가 이긴다(콘텐츠가 위아래로 조금 넘칠 수 있다)
 */
export function staffScale(heightPx: number, widthPx?: number): number {
  return Math.min(staffScaleMax(widthPx), Math.max(STAFF_SCALE_MIN, heightPx / (CONTENT_BOTTOM - CONTENT_TOP)));
}

/**
 * 타이밍 막대를 칸 아래 끝에서 들어 올리는 높이(CSS px). 칸이 악보보다 높으면 악보는 남는 높이의 가운데에 놓이므로,
 * 막대도 그 절반만큼 올려 박 번호 바로 아래에 붙인다(악보와 막대가 한 덩어리로 칸 가운데에 온다)
 */
export function overlayLift(heightPx: number, k: number, reservePx: number): number {
  return Math.max(0, (heightPx - reservePx - (CONTENT_BOTTOM - CONTENT_TOP) * k) / 2);
}

/** 악보 칸 안쪽 아래에 얹는 타이밍 막대가 차지하는 높이(CSS px): 얇은 막대 18 + 아래 여백 8(global.css .sheet-pager-overlay) + 틈 2 */
export const OVERLAY_RESERVE_PX = 28;

/**
 * 악보를 그리는 세로 이동량(논리 px). 칸에서 아래 reserve(논리 px)를 뺀 높이의 세로 가운데에 보표 콘텐츠를 놓는다.
 * 그림 좌표는 보표가 y 110–150에 있어 위가 비어 있으므로 위로 올릴 때(음수)도 그대로 쓴다.
 * 칸이 콘텐츠보다 낮으면 콘텐츠 위 끝을 칸 위 끝에 맞춘다(마디 번호·기둥이 위로 잘리지 않게, 넘침은 아래로)
 */
export function staffOffsetY(H: number, reserve = 0): number {
  const room = H - reserve - (CONTENT_BOTTOM - CONTENT_TOP);
  return Math.max(0, room / 2) - CONTENT_TOP;
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
