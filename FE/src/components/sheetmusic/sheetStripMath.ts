// drawSheet의 시간 → x 계산. 캔버스·DOM에 의존하지 않는다.

/** 곡 시각 t(ms)의 화면 x(px). 기준선(baseX)이 songTime을 가리킨다 */
export function xOfTime(t: number, songTime: number, width: number, barPx: number, baseRatio: number, barMs: number): number {
  return width * baseRatio + (t - songTime) * (barPx / barMs);
}

/** 마디선과 첫 칸 사이 여백(px). 가장 넓은 머리(동그라미 엑스 반폭 8.25)가 마디선에 잘리거나 겹치지 않게 둔다 */
export const BAR_LEAD_PX = 12;

/** 마디 왼쪽 x가 left, 마디 폭이 barPx일 때 마디 안 비율 ratio(0..1)의 x. ratio 0은 첫 칸 머리 중심, 1은 다음 마디선 */
export function xInBar(left: number, barPx: number, ratio: number): number {
  return left + BAR_LEAD_PX + ratio * (barPx - BAR_LEAD_PX);
}

/** 연속 모드의 칸 간격은 모두 같다. 첫 머리는 마디선과 떨어뜨린다. */
export function xInBarContinuous(left: number, barPx: number, ratio: number, stepsPerBar: number): number {
  return left + Math.min(BAR_LEAD_PX, barPx / stepsPerBar / 2) + ratio * barPx;
}

/** 곡 시각 t가 속한 마디(격자 원점 기준, 음수 마디 허용)를 찾아 그 마디 안 비율의 x를 돌려준다. 채보 밖 타격 점에 쓴다 */
export function xOfTimeInBar(
  t: number,
  songTime: number,
  width: number,
  barPx: number,
  baseRatio: number,
  barMs: number,
  originMs: number,
  stepsPerBar?: number,
): number {
  const bar = Math.floor((t - originMs) / barMs);
  const barStart = originMs + bar * barMs;
  const left = xOfTime(barStart, songTime, width, barPx, baseRatio, barMs);
  const ratio = (t - barStart) / barMs;
  return stepsPerBar ? xInBarContinuous(left, barPx, ratio, stepsPerBar) : xInBar(left, barPx, ratio);
}
