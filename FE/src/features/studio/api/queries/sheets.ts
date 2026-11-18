// 내 악보 목록 쿼리 (설계 TECH-351). 악보 업로드·삭제·제목 수정·곡 연결 뒤 ['sheets']를 무효화한다.
import { queryOptions } from '@tanstack/react-query';
import type { SheetPageResult } from '@/features/studio/domain/sheetMusic';
import { listSheets } from '@/features/studio/api/sheets';

export const sheetKeys = {
  all: ['sheets'] as const,
  list: () => ['sheets', 'list'] as const,
};

export function sheetListQuery() {
  return queryOptions<SheetPageResult>({
    queryKey: sheetKeys.list(),
    queryFn: ({ signal }) => listSheets(signal),
  });
}
