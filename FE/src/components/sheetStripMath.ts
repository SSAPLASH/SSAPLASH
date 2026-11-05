// drawSheet의 시간 → x 계산. 캔버스·DOM에 의존하지 않는다.

/** 곡 시각 t(ms)의 화면 x(px). 기준선(baseX)이 songTime을 가리킨다 */
export function xOfTime(t: number, songTime: number, width: number, barPx: number, baseRatio: number, barMs: number): number {
  return width * baseRatio + (t - songTime) * (barPx / barMs);
}
