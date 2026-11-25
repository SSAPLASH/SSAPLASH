// 박자 오차 공용 계산 (설계 MODE-006-minigame-tempo 3절). 타격 시각과 정답 시각의 차이, 빠름·늦음 가리기, 표시 글, 평균.
// 「인간 메트로놈」(408)과 「정적 뒤 한 방」(409)이 같이 쓴다. 정답 시각을 정하는 방법은 게임마다 달라 여기에 두지 않는다.
// 보정값을 빼는 일도 하지 않는다 — 소리에 맞춰 치는 게임은 보정한 타격 시각을 넘긴다.

/** 빠름·늦음·정박(오차 0) */
export type TimingSide = 'early' | 'late' | 'exact';

/** 타격 시각에서 정답 시각을 뺀 값을 반올림한 정수(ms). 음수면 빠름. 둘 다 `performance.now()` 기준 */
export function signedErrorMs(hitAt: number, targetAt: number): number {
  // -0이 나오지 않게 0을 더한다(표시와 비교가 0과 같게)
  return Math.round(hitAt - targetAt) + 0;
}

export function errorSide(errorMs: number): TimingSide {
  if (errorMs < 0) return 'early';
  return errorMs > 0 ? 'late' : 'exact';
}

/** 「34ms 빠름」·「8ms 늦음」·「정박」 */
export function formatError(errorMs: number): string {
  const side = errorSide(errorMs);
  if (side === 'exact') return '정박';
  return `${Math.abs(errorMs)}ms ${side === 'early' ? '빠름' : '늦음'}`;
}

/** 절댓값의 평균을 반올림한 정수. 빈 목록이면 null */
export function meanAbsMs(errors: readonly number[]): number | null {
  if (errors.length === 0) return null;
  return Math.round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length);
}
