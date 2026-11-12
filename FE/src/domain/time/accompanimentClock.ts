// 반주 재생 위치 계산(순수 함수). Accompaniment가 소스 시작·일시정지 시각에서 위치를 구할 때 쓴다.

/**
 * 재생 중 반주 위치(ms). 시작 시각 이전이면 fromMs, 끝을 넘으면 durationMs로 자른다.
 * @param startPerfMs 소스가 실제로 울리기 시작하는 performance.now 시각
 * @param fromMs 그 시각에 해당하는 반주 위치
 */
export function playbackPosition(startPerfMs: number, fromMs: number, perfMs: number, durationMs: number): number {
  const pos = perfMs - startPerfMs + fromMs;
  return Math.min(durationMs, Math.max(fromMs, pos));
}

/** 반주 0초가 울리는 performance.now 시각. 세션 startTime과 비교하는 동기 Δ의 기준 */
export function zeroPerfMs(startPerfMs: number, fromMs: number): number {
  return startPerfMs - fromMs;
}
