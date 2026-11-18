// 카운트다운 표시 계산 (설계 MODE-001-lead-in-bars 1-5 D8·D16·D17). 격자 시각(곡 시각 − 1마디 1박 원점)과 1마디 길이만 보고 숫자를 낸다.
// 카운트다운 3·2·1이 끝나면 1마디 준비 구간(불 켜짐)이 이어지고, 그 끝이 1마디 1박(격자 0)이다.
// 시계·상태 판단과 렌더링은 하지 않는다. 아무것도 import하지 않는다(엔진이 이 상수를 가져다 쓴다).

/** 카운트다운 길이(ms). 마디·박과 무관하게 3·2·1 (이 뒤에 1마디 준비 구간이 더 있다) */
export const COUNTDOWN_MS = 3000;
/** 숫자 한 칸 간격(ms) */
export const COUNTDOWN_STEP_MS = 1000;

/** 부동소수 경계 보정(ms 나눗셈이 정수 초에서 미세하게 어긋나는 것을 흡수) */
const EPS = 1e-9;

/**
 * 카운트다운 숫자(3·2·1). 준비 마디 시작(격자 −leadBarMs)까지 남은 초(올림)를 1~3(COUNTDOWN_MS ÷ 한 칸)으로 자른다.
 * 준비 마디 시작 이후(e ≥ 0)이거나 준비 마디가 없으면(leadBarMs ≤ 0) null — 이때는 오버레이 없이 불이 켜진다.
 * @param gridMs 격자 시각(곡 시각 − 1마디 1박 원점)
 * @param leadBarMs 준비 마디 길이(ms) = 1마디
 */
export function countdownValue(gridMs: number, leadBarMs: number): number | null {
  if (leadBarMs <= 0) return null;
  const e = gridMs + leadBarMs;
  if (e >= 0) return null;
  return Math.min(COUNTDOWN_MS / COUNTDOWN_STEP_MS, Math.max(1, Math.ceil(-e / COUNTDOWN_STEP_MS - EPS)));
}
