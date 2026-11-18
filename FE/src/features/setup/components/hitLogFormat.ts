// 타격 확인(HitLog)의 표시 규칙. 컴포넌트 밖 순수 함수로 두어 테스트하기 쉽게 한다.

/** 타격 확인에 보이는 최대 행 수 */
export const HIT_LOG_ROWS = 5;

/** 무대 위 떠 있는 타격 확인 카드에 보이는 행 수(넓을 때). 좁으면 무대 아래에서 HIT_LOG_ROWS행 전부 보인다. 자리는 CSS 컨테이너 쿼리가 정한다 */
export const HIT_LOG_FLOAT_ROWS = 3;

/** 경과 시간 문구: 방금(<2초) · n초 전 · n분 전 */
export function hitAgoText(at: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 2) return '방금';
  if (sec < 60) return `${sec}초 전`;
  return `${Math.floor(sec / 60)}분 전`;
}
