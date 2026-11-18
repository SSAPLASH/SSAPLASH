// 다이얼로그 포커스 순환 계산(순수 함수). DOM을 조회하지 않아 node 환경에서 테스트한다.

/** 다음 초점 인덱스. 요소가 없으면 -1, 현재가 -1이면 앞으로는 0·뒤로는 마지막, 끝에서 처음으로 돈다 */
export function cycleIndex(length: number, current: number, backward: boolean): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return backward ? length - 1 : 0;
  if (backward) return current === 0 ? length - 1 : current - 1;
  return current === length - 1 ? 0 : current + 1;
}

/** 열릴 때 초점을 둘 인덱스. 선호가 활성이면 선호, 아니면 첫 활성, 없으면 -1 */
export function initialFocusIndex(enabled: boolean[], preferred: number | null): number {
  if (preferred !== null && enabled[preferred]) return preferred;
  return enabled.indexOf(true);
}

/** 재초점 필요 여부. 안쪽 요소에 있던 포커스가 그 요소가 문서에서 사라진 탓에 body로 떨어졌을 때만 true */
export function needsRefocus(hadFocusInside: boolean, stillConnected: boolean, activeIsBody: boolean): boolean {
  return hadFocusInside && !stillConnected && activeIsBody;
}
