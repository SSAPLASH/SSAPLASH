// 제목 흐름(회전목마) 계산 (설계 CHART-003 라이브러리 재생바 3절). DOM을 모르는 순수 함수.

/** 한 바퀴 최소 시간(초) */
export const MARQUEE_MIN_SEC = 6;
/** 흐르는 속도(px/초) */
export const MARQUEE_SPEED_PX = 40;

const positive = (n: number) => Number.isFinite(n) && n > 0;

/** 제목이 칸보다 길어 잘리는지. 칸보다 긴 제목만 흐른다(D3). 측정값이 없으면 거짓 */
export function marqueeOverflows(containerPx: number, textPx: number): boolean {
  if (!positive(containerPx) || !positive(textPx)) return false;
  return textPx > containerPx;
}

/** 묶음 하나(제목 + 뒤 간격)가 지나가는 시간(초). 너비를 모르거나 너무 짧으면 최소 시간 */
export function marqueeDurationSec(groupPx: number): number {
  if (!positive(groupPx)) return MARQUEE_MIN_SEC;
  return Math.max(MARQUEE_MIN_SEC, Math.round((groupPx / MARQUEE_SPEED_PX) * 10) / 10);
}
