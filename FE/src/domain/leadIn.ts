// 리드인(시작 전 마디) 표시 계산 (설계 MODE-001-lead-in-bars 3-1). 격자 시각(곡 시각 − 1마디 1박 원점)만 보고 숫자·빈 마디 여부를 낸다.
// 시계·상태 판단과 렌더링은 하지 않는다. 아무것도 import하지 않는다.

/** 부동소수 경계 보정(ms 나눗셈이 정수 박에서 미세하게 어긋나는 것을 흡수) */
const EPS = 1e-9;

/**
 * 마지막 리드인 마디의 남은 박 수(4/4면 4·3·2·1). 격자 시각이 0 이상이거나 그 마디보다 앞(빈 마디·긴 인트로)이면 null.
 * 숫자는 박이 시작하는 순간 바뀐다(−1박 길이가 되는 순간 4 → 3).
 */
export function leadInCount(gridMs: number, beatMs: number, beatsPerBar: number): number | null {
  const barMs = beatMs * beatsPerBar;
  if (gridMs >= 0 || gridMs < -barMs - EPS) return null;
  return Math.max(1, Math.ceil(-gridMs / beatMs - EPS));
}

/**
 * 빈 마디(리드인 앞 N−1마디, 숫자 없음) 구간인지.
 * 리드인 마디 수가 1 이하면 빈 마디가 없다. 리드인 앞(긴 인트로)은 거짓.
 */
export function isLeadInBlank(gridMs: number, beatMs: number, beatsPerBar: number, leadInBars: number): boolean {
  if (leadInBars <= 1) return false;
  const barMs = beatMs * beatsPerBar;
  return gridMs >= -barMs * leadInBars - EPS && gridMs < -barMs - EPS;
}
