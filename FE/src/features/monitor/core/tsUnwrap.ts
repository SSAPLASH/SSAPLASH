// 스틱 시계 u32 µs 랩어라운드(약 71.6분)를 다루는 순수 함수. 판정 경로(ClockSync)와는 독립이다.
// 패킷 로그는 바퀴 수를 세지 않는 환산(nearBrowserMs·normalizeOffsetMs)을 쓴다: 소스의 ClockSync와 모니터가 각자 바퀴를 세면
// 한쪽만 초기화될 때(스틱 재연결, 로그 지우기) 정확히 한 바퀴만큼 어긋나기 때문이다.

/** u32 µs 한 주기 */
export const WRAP_US = 2 ** 32;
/** 한 주기를 ms로 */
export const WRAP_MS = WRAP_US / 1000;

/**
 * 원시(펼치지 않은) µs → 브라우저 시각(ms). 한 바퀴의 정수배를 더해 수신 시각에 가장 가까운 값을 고른다.
 * 오프셋이 몇 바퀴를 품고 있든 결과가 같다. 시계 오프셋이 아직 없으면 null
 */
export function nearBrowserMs(rawUs: number, clockOffsetMs: number | null, recvTime: number): number | null {
  if (clockOffsetMs === null) return null;
  const v = rawUs / 1000 + clockOffsetMs;
  return v + Math.round((recvTime - v) / WRAP_MS) * WRAP_MS;
}

/** 오프셋에서 한 바퀴의 정수배를 빼 기준값과 반 바퀴 이내로 맞춘다. 랩·초기화 전후로 그래프가 튀지 않게 한다 */
export function normalizeOffsetMs(offsetMs: number, refMs: number): number {
  return offsetMs - Math.round((offsetMs - refMs) / WRAP_MS) * WRAP_MS;
}

/** 브라우저 시각 기준 "수신 시각보다 얼마나 미래인가"(ms). 양수면 미래. 시각을 모르면 null */
export function futureMs(tBrowser: number | null, recvTime: number): number | null {
  return tBrowser === null ? null : tBrowser - recvTime;
}
