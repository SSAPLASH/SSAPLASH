// 쪽 번호 묶음 계산 (ui/Pagination). 컴포넌트 파일과 나눠 Fast Refresh 경고를 피한다.

/** 한 번에 보이는 쪽 번호 수 */
export const PAGINATION_GROUP = 10;

/** 현재 쪽이 속한 묶음의 [시작, 끝] 쪽(0부터, 끝 포함) */
export function pageGroup(page: number, pageCount: number): [number, number] {
  const start = Math.floor(page / PAGINATION_GROUP) * PAGINATION_GROUP;
  return [start, Math.min(start + PAGINATION_GROUP, pageCount) - 1];
}
