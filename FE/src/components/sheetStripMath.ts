// SheetStrip의 순수 좌표 계산 (시간 → x, 보이는 마디 범위). 캔버스·DOM에 의존하지 않는다.

/** 곡 시각 t(ms)의 화면 x(px). 기준선(baseX)이 songTime을 가리킨다 */
export function xOfTime(t: number, songTime: number, width: number, barPx: number, baseRatio: number, barMs: number): number {
  return width * baseRatio + (t - songTime) * (barPx / barMs);
}

/**
 * 화면에 걸리는 마디 범위(앞뒤 1마디 여유 포함, 0..totalBars-1로 자른다).
 * 그릴 마디가 없으면 first > last.
 */
export function visibleBars(
  songTime: number,
  width: number,
  barPx: number,
  baseRatio: number,
  barMs: number,
  totalBars: number,
): { first: number; last: number } {
  const pxPerMs = barPx / barMs;
  const baseX = width * baseRatio;
  const leftMs = songTime - baseX / pxPerMs;
  const rightMs = songTime + (width - baseX) / pxPerMs;
  const first = Math.max(0, Math.floor(leftMs / barMs) - 1);
  const last = Math.min(totalBars - 1, Math.floor(rightMs / barMs) + 1);
  return { first, last };
}

/** reduced-motion용: 곡 시각을 마디 경계로 내린다 */
export function snapToBar(songTime: number, barMs: number): number {
  return Math.floor(songTime / barMs) * barMs;
}
