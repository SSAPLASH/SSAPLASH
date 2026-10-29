// 마디 고정 악보(SheetPager)의 순수 계산: 페이지당 마디 수, 슬롯별 마디, 커서 위치. 캔버스·DOM에 의존하지 않는다.

/** 악보 영역 폭(px)에 따른 페이지당 마디 수 */
export function barsPerPage(width: number): number {
  return width < 900 ? 2 : 4;
}

export interface PagerSlot {
  /** 슬롯에 그릴 마디 번호(0부터). 곡 끝 너머면 null */
  bar: number | null;
  /** 아직 커서가 오지 않은 다음 페이지 마디(흐리게 그린다) */
  upcoming: boolean;
}

/**
 * 슬롯별 마디. 커서가 슬롯을 떠난 뒤 1박이 지나면 그 자리를 다음 페이지 마디로 바꿔 끼운다(upcoming).
 * 커서가 다음 페이지로 넘어가면 그 페이지가 현재 페이지이므로 커서 오른쪽 슬롯은 정상으로 보인다.
 */
export function pagerSlots(songTime: number, barMs: number, beatMs: number, perPage: number, totalBars: number): PagerSlot[] {
  const t = Math.max(songTime, 0);
  const b = Math.floor(t / barMs);
  const page = Math.floor(b / perPage);
  const k = b - page * perPage;
  return Array.from({ length: perPage }, (_, i) => {
    let bar: number;
    let upcoming = false;
    if (i >= k) {
      bar = page * perPage + i;
    } else {
      const leftAt = (page * perPage + i + 1) * barMs;
      if (t - leftAt >= beatMs) {
        bar = (page + 1) * perPage + i;
        upcoming = true;
      } else {
        bar = page * perPage + i;
      }
    }
    return bar >= totalBars ? { bar: null, upcoming: false } : { bar, upcoming };
  });
}

/** 커서가 있는 슬롯 번호와 마디 안 진행 비율 0..1. 카운트인(songTime < 0)이면 첫 슬롯 왼쪽 */
export function cursorPos(songTime: number, barMs: number, perPage: number): { slot: number; ratio: number } {
  if (songTime < 0) return { slot: 0, ratio: 0 };
  const b = Math.floor(songTime / barMs);
  return { slot: b % perPage, ratio: Math.min(1, Math.max(0, (songTime - b * barMs) / barMs)) };
}

/** reduced-motion용: 곡 시각을 박 경계로 내린다 */
export function snapToBeat(songTime: number, beatMs: number): number {
  return Math.floor(songTime / beatMs) * beatMs;
}
