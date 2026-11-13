// 악보 항목 문구 (설계 CHART-001 악보 보관 4-2). 카드·목록 줄이 같이 쓴다.
import type { SheetSummary } from '@/features/studio/domain/sheetMusic';

/** 부제 자리 문구: 「악보 · 이미지 n쪽」 또는 「악보 · PDF」 */
export function sheetSubtitle(sheet: SheetSummary): string {
  return sheet.kind === 'PDF' ? '악보 · PDF' : `악보 · 이미지 ${sheet.pageCount}쪽`;
}
